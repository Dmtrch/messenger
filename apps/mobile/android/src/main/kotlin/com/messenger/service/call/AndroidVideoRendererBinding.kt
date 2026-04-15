package com.messenger.service.call

import org.webrtc.EglBase
import org.webrtc.SurfaceViewRenderer

class AndroidVideoRendererBinding(val eglBase: EglBase = EglBase.create()) {
    var localRenderer: SurfaceViewRenderer? = null
    var remoteRenderer: SurfaceViewRenderer? = null

    fun release() {
        localRenderer?.release()
        localRenderer = null
        remoteRenderer?.release()
        remoteRenderer = null
        eglBase.release()
    }
}
