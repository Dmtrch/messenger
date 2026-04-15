package com.messenger.service.call

data class CallOfferSignal(
    val callId: String,
    val chatId: String,
    val fromUserId: String,
    val sdp: String,
    val isVideo: Boolean,
)

data class CallAnswerSignal(
    val callId: String,
    val sdp: String,
)

data class IceCandidateSignal(
    val callId: String,
    val sdpMid: String,
    val sdpMLineIndex: Int,
    val candidate: String,
)
