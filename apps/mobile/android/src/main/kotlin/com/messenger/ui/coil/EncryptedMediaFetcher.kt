// src/main/kotlin/com/messenger/ui/coil/EncryptedMediaFetcher.kt
package com.messenger.ui.coil

import coil.ImageLoader
import coil.decode.DataSource
import coil.decode.ImageSource
import coil.fetch.FetchResult
import coil.fetch.Fetcher
import coil.fetch.SourceResult
import coil.request.Options
import com.messenger.service.ApiClient
import okio.Buffer

data class EncryptedMediaRequest(val mediaId: String, val mediaKey: String)

class EncryptedMediaFetcher(
    private val data: EncryptedMediaRequest,
    private val apiClient: ApiClient,
    private val options: Options,
) : Fetcher {

    override suspend fun fetch(): FetchResult {
        val bytes = apiClient.fetchDecryptedMedia(data.mediaId, data.mediaKey)
        val source = Buffer().write(bytes)
        return SourceResult(
            source = ImageSource(source, options.context),
            mimeType = null,
            dataSource = DataSource.NETWORK,
        )
    }

    class Factory(private val apiClient: ApiClient) : Fetcher.Factory<EncryptedMediaRequest> {
        override fun create(
            data: EncryptedMediaRequest,
            options: Options,
            imageLoader: ImageLoader,
        ): Fetcher = EncryptedMediaFetcher(data, apiClient, options)
    }
}
