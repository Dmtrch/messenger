package sfu_test

import (
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/messenger/server/internal/sfu"
)

func TestNewManager_NotNil(t *testing.T) {
	m := sfu.NewManager()
	if m == nil {
		t.Fatal("NewManager() returned nil")
	}
}

func TestCreateRoom_ReturnsRoomWithCorrectFields(t *testing.T) {
	m := sfu.NewManager()
	room := m.CreateRoom("room-1", "chat-1", "user-1")

	if room == nil {
		t.Fatal("CreateRoom() returned nil")
	}
	if room.ID != "room-1" {
		t.Errorf("room.ID = %q, want %q", room.ID, "room-1")
	}
	if room.ChatID != "chat-1" {
		t.Errorf("room.ChatID = %q, want %q", room.ChatID, "chat-1")
	}
	if room.CreatorID != "user-1" {
		t.Errorf("room.CreatorID = %q, want %q", room.CreatorID, "user-1")
	}
}

func TestGetRoom_FindsCreatedRoom(t *testing.T) {
	m := sfu.NewManager()
	m.CreateRoom("room-2", "chat-2", "user-2")

	got, err := m.GetRoom("room-2")
	if err != nil {
		t.Fatalf("GetRoom returned unexpected error: %v", err)
	}
	if got == nil {
		t.Fatal("GetRoom returned nil room")
	}
	if got.ID != "room-2" {
		t.Errorf("GetRoom returned room with ID %q, want %q", got.ID, "room-2")
	}
}

func TestGetRoom_UnknownID_ReturnsErrRoomNotFound(t *testing.T) {
	m := sfu.NewManager()
	_, err := m.GetRoom("non-existent-id")
	if err == nil {
		t.Fatal("GetRoom for unknown ID must return error, got nil")
	}
	if !errors.Is(err, sfu.ErrRoomNotFound) {
		t.Errorf("GetRoom error = %v, want ErrRoomNotFound", err)
	}
}

func TestDeleteRoom_RemovesRoom(t *testing.T) {
	m := sfu.NewManager()
	m.CreateRoom("room-3", "chat-3", "user-3")

	if err := m.DeleteRoom("room-3"); err != nil {
		t.Fatalf("DeleteRoom returned unexpected error: %v", err)
	}

	_, err := m.GetRoom("room-3")
	if !errors.Is(err, sfu.ErrRoomNotFound) {
		t.Errorf("GetRoom after DeleteRoom = %v, want ErrRoomNotFound", err)
	}
}

func TestDeleteRoom_UnknownID_ReturnsErrRoomNotFound(t *testing.T) {
	m := sfu.NewManager()
	err := m.DeleteRoom("does-not-exist")
	if !errors.Is(err, sfu.ErrRoomNotFound) {
		t.Errorf("DeleteRoom for unknown ID = %v, want ErrRoomNotFound", err)
	}
}

func TestCreateRoom_Concurrent_NoDataRace(t *testing.T) {
	m := sfu.NewManager()

	const goroutines = 10
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			roomID := fmt.Sprintf("room-concurrent-%d", idx)
			chatID := fmt.Sprintf("chat-%d", idx)
			room := m.CreateRoom(roomID, chatID, "user-concurrent")
			if room == nil {
				t.Errorf("goroutine %d: CreateRoom returned nil", idx)
			}
		}(i)
	}

	wg.Wait()
}

func TestRoom_Participants_EmptyOnNew(t *testing.T) {
	m := sfu.NewManager()
	room := m.CreateRoom("room-4", "chat-4", "user-4")

	if len(room.Participants) != 0 {
		t.Errorf("Participants on new room = %d, want 0", len(room.Participants))
	}
}

func TestLeave_NonExistentUser_NoPanic(t *testing.T) {
	m := sfu.NewManager()
	m.CreateRoom("room-5", "chat-5", "user-5")

	// Leave with unknown userID must not error or panic.
	err := m.Leave("room-5", "unknown-user-id")
	if err != nil {
		t.Errorf("Leave with unknown userID returned error: %v", err)
	}
}

func TestLeave_UnknownRoom_ReturnsErrRoomNotFound(t *testing.T) {
	m := sfu.NewManager()
	err := m.Leave("no-such-room", "user-x")
	if !errors.Is(err, sfu.ErrRoomNotFound) {
		t.Errorf("Leave for unknown room = %v, want ErrRoomNotFound", err)
	}
}

func TestJoin_UnknownRoom_ReturnsErrRoomNotFound(t *testing.T) {
	m := sfu.NewManager()
	_, err := m.Join("no-such-room", "user-1", "device-1", "fake-sdp")
	if !errors.Is(err, sfu.ErrRoomNotFound) {
		t.Errorf("Join for unknown room = %v, want ErrRoomNotFound", err)
	}
}

func TestJoin_EmptySDP_AddsParticipant(t *testing.T) {
	// Join with empty SDP returns a stub answer without real WebRTC negotiation.
	m := sfu.NewManager()
	m.CreateRoom("room-6", "chat-6", "user-6")

	answer, err := m.Join("room-6", "user-6", "device-1", "")
	if err != nil {
		t.Fatalf("Join with empty SDP returned error: %v", err)
	}
	if answer == "" {
		t.Error("Join must return non-empty SDP answer (even stub)")
	}

	room, _ := m.GetRoom("room-6")
	if len(room.Participants) != 1 {
		t.Errorf("Participants after Join = %d, want 1", len(room.Participants))
	}
	if room.Participants[0].UserID != "user-6" {
		t.Errorf("Participant UserID = %q, want %q", room.Participants[0].UserID, "user-6")
	}
}

func TestJoin_SameUserDevice_ReturnsErrAlreadyInRoom(t *testing.T) {
	m := sfu.NewManager()
	m.CreateRoom("room-7", "chat-7", "user-7")

	if _, err := m.Join("room-7", "user-7", "device-1", ""); err != nil {
		t.Fatalf("first Join failed: %v", err)
	}

	_, err := m.Join("room-7", "user-7", "device-1", "")
	if !errors.Is(err, sfu.ErrAlreadyInRoom) {
		t.Errorf("second Join = %v, want ErrAlreadyInRoom", err)
	}
}

func TestJoin_InvalidSDP_ReturnsError(t *testing.T) {
	// With a real SDP string (non-empty, non-stub), pion will reject it.
	m := sfu.NewManager()
	m.CreateRoom("room-8", "chat-8", "user-8")

	_, err := m.Join("room-8", "user-8", "device-1", "not-valid-sdp")
	if err == nil {
		t.Error("JoinRoom with invalid SDP must return an error, got nil")
	}
}
