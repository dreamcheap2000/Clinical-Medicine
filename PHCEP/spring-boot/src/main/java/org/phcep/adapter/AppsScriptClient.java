package org.phcep.adapter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;

final class AppsScriptClient {
    interface Transport {
        Response post(URI endpoint, byte[] envelope) throws Exception;
    }
    record Response(int status, byte[] body) {}
    private final ObjectMapper mapper;
    private final URI endpoint;
    private final Transport transport;

    AppsScriptClient(ObjectMapper mapper, URI endpoint, Transport transport) {
        this.mapper = mapper;
        this.endpoint = endpoint;
        this.transport = transport;
    }

    boolean accept(byte[] envelope) {
        try {
            // Preserve the ingress nonce so the shared durable nonce ledger can reject replays.
            Response response = transport.post(endpoint, envelope);
            if (response.status() != 200 || response.body().length > GoogleTransport.MAX_RESPONSE) {
                return false;
            }
            JsonNode result = mapper.reader()
                    .with(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
                    .with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readTree(response.body());
            return result != null && result.isObject() && result.path("ok").isBoolean()
                    && result.path("ok").booleanValue() && !result.has("error");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception upstreamFailure) {
            // No payload, response, secret, or exception details are logged.
        }
        return false;
    }
}
