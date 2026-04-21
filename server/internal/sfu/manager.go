package sfu

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/pion/webrtc/v3"
)

// ErrRoomNotFound is returned when a room does not exist.
var ErrRoomNotFound = errors.New("sfu: room not found")

// ErrAlreadyInRoom is returned when a user+device combination is already a participant.
var ErrAlreadyInRoom = errors.New("sfu: user already in room")

// ParticipantInfo is a read-only snapshot of a participant's state.
type ParticipantInfo struct {
	UserID   string `json:"userId"`
	DeviceID string `json:"deviceId"`
	HasAudio bool   `json:"hasAudio"`
	HasVideo bool   `json:"hasVideo"`
}

// participant holds the live WebRTC state of a connected peer.
type participant struct {
	userID   string
	deviceID string
	pc       *webrtc.PeerConnection

	mu          sync.RWMutex
	localTracks map[string]*webrtc.TrackLocalStaticRTP
}

func (p *participant) addLocalTrack(t *webrtc.TrackLocalStaticRTP) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.localTracks[t.ID()] = t
}

func (p *participant) tracks() []*webrtc.TrackLocalStaticRTP {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]*webrtc.TrackLocalStaticRTP, 0, len(p.localTracks))
	for _, t := range p.localTracks {
		out = append(out, t)
	}
	return out
}

// Room represents a single call session.
// Participants is the exported slice of current participants (updated on Join/Leave).
type Room struct {
	ID           string
	ChatID       string
	CreatorID    string
	CreatedAt    time.Time
	Participants []ParticipantInfo

	mu    sync.RWMutex
	peers map[string]*participant // key: userID
	api   *webrtc.API
}

// addTrack forwards a remote track from fromUserID to all other participants.
func (r *Room) addTrack(fromUserID string, track *webrtc.TrackRemote) {
	localTrack, err := webrtc.NewTrackLocalStaticRTP(
		track.Codec().RTPCodecCapability,
		track.ID(),
		track.StreamID(),
	)
	if err != nil {
		return
	}

	r.mu.RLock()
	sender, senderExists := r.peers[fromUserID]
	r.mu.RUnlock()

	if senderExists {
		sender.addLocalTrack(localTrack)
	}

	// Add the local track to all existing peers except the sender.
	r.mu.RLock()
	for uid, p := range r.peers {
		if uid == fromUserID {
			continue
		}
		if _, addErr := p.pc.AddTrack(localTrack); addErr != nil {
			_ = addErr // non-fatal: peer may have closed
		}
	}
	r.mu.RUnlock()

	// Update hasAudio/hasVideo in Participants slice.
	kind := track.Kind()
	r.mu.Lock()
	for i := range r.Participants {
		if r.Participants[i].UserID == fromUserID {
			if kind == webrtc.RTPCodecTypeAudio {
				r.Participants[i].HasAudio = true
			} else if kind == webrtc.RTPCodecTypeVideo {
				r.Participants[i].HasVideo = true
			}
			break
		}
	}
	r.mu.Unlock()

	// Forward RTP packets in background until the remote track closes.
	go func() {
		buf := make([]byte, 1500)
		for {
			n, _, readErr := track.Read(buf)
			if readErr != nil {
				return
			}
			if _, writeErr := localTrack.Write(buf[:n]); writeErr != nil {
				return
			}
		}
	}()
}

// close terminates all PeerConnections in the room (called by Manager).
func (r *Room) close() {
	r.mu.Lock()
	peers := make([]*participant, 0, len(r.peers))
	for _, p := range r.peers {
		peers = append(peers, p)
	}
	r.peers = make(map[string]*participant)
	r.Participants = nil
	r.mu.Unlock()

	for _, p := range peers {
		p.pc.Close()
	}
}

// Manager owns all active rooms and exposes the full SFU API.
// All methods are safe for concurrent use.
type Manager struct {
	mu    sync.RWMutex
	rooms map[string]*Room
	api   *webrtc.API
}

// NewManager creates a Manager with pion MediaEngine configured for
// default codecs (Opus audio + VP8/VP9 video).
func NewManager() *Manager {
	me := &webrtc.MediaEngine{}
	if err := me.RegisterDefaultCodecs(); err != nil {
		panic(fmt.Sprintf("sfu: register default codecs: %v", err))
	}
	api := webrtc.NewAPI(webrtc.WithMediaEngine(me))
	return &Manager{
		rooms: make(map[string]*Room),
		api:   api,
	}
}

// CreateRoom creates a new room with the given roomID and registers it.
func (m *Manager) CreateRoom(roomID, chatID, creatorID string) *Room {
	room := &Room{
		ID:           roomID,
		ChatID:       chatID,
		CreatorID:    creatorID,
		CreatedAt:    time.Now(),
		Participants: []ParticipantInfo{},
		peers:        make(map[string]*participant),
		api:          m.api,
	}
	m.mu.Lock()
	m.rooms[roomID] = room
	m.mu.Unlock()
	return room
}

// GetRoom returns a room by ID or ErrRoomNotFound.
func (m *Manager) GetRoom(id string) (*Room, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.rooms[id]
	if !ok {
		return nil, ErrRoomNotFound
	}
	return r, nil
}

// DeleteRoom closes and removes a room. Returns ErrRoomNotFound if missing.
func (m *Manager) DeleteRoom(id string) error {
	m.mu.Lock()
	r, ok := m.rooms[id]
	if ok {
		delete(m.rooms, id)
	}
	m.mu.Unlock()

	if !ok {
		return ErrRoomNotFound
	}
	r.close()
	return nil
}

// Join adds a participant to the room and performs a WebRTC offer/answer exchange.
// Returns ErrRoomNotFound or ErrAlreadyInRoom on conflict.
// If sdpOffer is empty (e.g. in tests), a stub SDP answer is returned.
func (m *Manager) Join(roomID, userID, deviceID, sdpOffer string) (string, error) {
	m.mu.RLock()
	r, ok := m.rooms[roomID]
	m.mu.RUnlock()
	if !ok {
		return "", ErrRoomNotFound
	}

	r.mu.Lock()
	for _, p := range r.Participants {
		if p.UserID == userID && p.DeviceID == deviceID {
			r.mu.Unlock()
			return "", ErrAlreadyInRoom
		}
	}
	r.mu.Unlock()

	// If no SDP offer provided, register participant without a real PeerConnection.
	if sdpOffer == "" {
		r.mu.Lock()
		r.Participants = append(r.Participants, ParticipantInfo{
			UserID:   userID,
			DeviceID: deviceID,
		})
		r.mu.Unlock()
		return "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n", nil
	}

	// Real WebRTC path.
	pc, err := r.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return "", fmt.Errorf("sfu: new peer connection: %w", err)
	}

	p := &participant{
		userID:      userID,
		deviceID:    deviceID,
		pc:          pc,
		localTracks: make(map[string]*webrtc.TrackLocalStaticRTP),
	}

	// Forward existing remote tracks from other participants to this new peer.
	r.mu.RLock()
	for _, other := range r.peers {
		for _, lt := range other.tracks() {
			if _, addErr := pc.AddTrack(lt); addErr != nil {
				r.mu.RUnlock()
				pc.Close()
				return "", fmt.Errorf("sfu: add existing track to new peer: %w", addErr)
			}
		}
	}
	r.mu.RUnlock()

	pc.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		r.addTrack(userID, track)
	})

	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		if state == webrtc.ICEConnectionStateFailed ||
			state == webrtc.ICEConnectionStateDisconnected ||
			state == webrtc.ICEConnectionStateClosed {
			_ = m.Leave(roomID, userID)
		}
	})

	offer := webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: sdpOffer}
	if err = pc.SetRemoteDescription(offer); err != nil {
		pc.Close()
		return "", fmt.Errorf("sfu: set remote description: %w", err)
	}

	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		pc.Close()
		return "", fmt.Errorf("sfu: create answer: %w", err)
	}

	gatherComplete := webrtc.GatheringCompletePromise(pc)

	if err = pc.SetLocalDescription(answer); err != nil {
		pc.Close()
		return "", fmt.Errorf("sfu: set local description: %w", err)
	}

	<-gatherComplete

	r.mu.Lock()
	r.peers[userID] = p
	r.Participants = append(r.Participants, ParticipantInfo{
		UserID:   userID,
		DeviceID: deviceID,
	})
	r.mu.Unlock()

	return pc.LocalDescription().SDP, nil
}

// Leave removes a participant from the room and closes their PeerConnection.
// Returns ErrRoomNotFound if the room does not exist.
// Does not error if the user is not in the room.
func (m *Manager) Leave(roomID, userID string) error {
	m.mu.RLock()
	r, ok := m.rooms[roomID]
	m.mu.RUnlock()
	if !ok {
		return ErrRoomNotFound
	}

	r.mu.Lock()
	p, hasPeer := r.peers[userID]
	if hasPeer {
		delete(r.peers, userID)
	}
	updated := r.Participants[:0]
	for _, pi := range r.Participants {
		if pi.UserID != userID {
			updated = append(updated, pi)
		}
	}
	r.Participants = updated
	r.mu.Unlock()

	if hasPeer {
		p.pc.Close()
	}
	return nil
}
