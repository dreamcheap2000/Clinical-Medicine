package org.phcep.adapter;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

@ExtendWith(OutputCaptureExtension.class)
class AppsScriptClientTest {
    final ObjectMapper mapper = new ObjectMapper();
    final byte[] envelope = "{\"original\":\"envelope\"}".getBytes(StandardCharsets.UTF_8);

    AppsScriptClient client(AppsScriptClient.Transport transport) {
        return new AppsScriptClient(mapper, GoogleTransport.endpoint("https://script.google.com/macros/s/test/exec"),
                transport);
    }

    @Test
    void forwardsOriginalEnvelopeExactlyOnce() {
        AtomicInteger attempts = new AtomicInteger();
        assertTrue(client((uri, forwarded) -> {
            assertArrayEquals(envelope, forwarded);
            attempts.incrementAndGet();
            return new AppsScriptClient.Response(200, "{\"ok\":true}".getBytes(StandardCharsets.UTF_8));
        }).accept(envelope));
        assertEquals(1, attempts.get());
    }

    @Test
    void neverRetriesTransientResponsesExceptionsOrApplicationErrors(CapturedOutput output) {
        for (int status : new int[]{408, 429, 500, 503, 403, 302, 307}) {
            AtomicInteger attempts = new AtomicInteger();
            assertFalse(client((uri, forwarded) -> {
                attempts.incrementAndGet();
                return new AppsScriptClient.Response(status, new byte[0]);
            }).accept(envelope));
            assertEquals(1, attempts.get());
        }
        AtomicInteger attempts = new AtomicInteger();
        assertFalse(client((uri, forwarded) -> {
            attempts.incrementAndGet();
            throw new java.io.IOException("sensitive detail");
        }).accept(envelope));
        assertEquals(1, attempts.get());
        for (String body : new String[]{"{\"ok\":false,\"error\":\"REPLAY\"}", "{\"ok\":\"true\"}",
                "{\"ok\":true,\"ok\":false}", "{\"ok\":true}{}", "not JSON", "{}",
                "{\"ok\":true,\"error\":\"PRIVATE_DETAIL\"}", "{\"ok\":true,\"error\":null}",
                "{\"ok\":true,\"error\":false}"}) {
            assertFalse(client((uri, forwarded) -> new AppsScriptClient.Response(200,
                    body.getBytes(StandardCharsets.UTF_8))).accept(envelope));
        }
        assertFalse(output.getAll().contains("sensitive detail"));
        assertFalse(output.getAll().contains("PRIVATE_DETAIL"));
    }
}
