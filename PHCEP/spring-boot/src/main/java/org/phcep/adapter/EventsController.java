package org.phcep.adapter;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
final class EventsController {
    private final EnvelopeCodec codec;
    private final AppsScriptClient client;

    EventsController(EnvelopeCodec codec, AppsScriptClient client) {
        this.codec = codec;
        this.client = client;
    }

    @PostMapping(path = "/internal/events", consumes = "application/json", produces = "application/json")
    ResponseEntity<Map<String, Object>> events(HttpServletRequest request) {
        byte[] envelope;
        try {
            if (request.getContentLengthLong() > EnvelopeCodec.MAX_ENVELOPE) {
                return failure(413, "PAYLOAD_TOO_LARGE");
            }
            envelope = request.getInputStream().readNBytes(EnvelopeCodec.MAX_ENVELOPE + 1);
            if (envelope.length > EnvelopeCodec.MAX_ENVELOPE) {
                return failure(413, "PAYLOAD_TOO_LARGE");
            }
            codec.verify(envelope);
        } catch (Exception invalidEnvelope) {
            return failure(401, "INVALID_ENVELOPE");
        }
        return client.accept(envelope) ? ResponseEntity.ok(Map.of("ok", true))
                : failure(502, "UPSTREAM_FAILED");
    }

    private ResponseEntity<Map<String, Object>> failure(int status, String code) {
        return ResponseEntity.status(status).body(Map.of("ok", false, "error", code));
    }
}
