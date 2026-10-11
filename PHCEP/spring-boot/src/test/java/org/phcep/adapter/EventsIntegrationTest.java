package org.phcep.adapter;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "GATEWAY_SIGNING_SECRET=test-only-gateway-key-with-32-bytes",
        "LINE_CHANNEL_SECRET=distinct-test-only-line-key",
        "PHCEP_APPS_SCRIPT_URL=https://script.google.com/macros/s/test/exec"})
class EventsIntegrationTest {
    @LocalServerPort int port;
    @Autowired EnvelopeCodec codec;
    @Autowired ObjectMapper mapper;
    @MockitoBean AppsScriptClient.Transport transport;

    ResponseEntity<String> post(byte[] envelope) {
        try {
            var request = java.net.http.HttpRequest.newBuilder(
                    java.net.URI.create("http://127.0.0.1:" + port + "/internal/events"))
                    .header("Content-Type", "application/json")
                    .POST(java.net.http.HttpRequest.BodyPublishers.ofByteArray(envelope)).build();
            var response = java.net.http.HttpClient.newHttpClient().send(request,
                    java.net.http.HttpResponse.BodyHandlers.ofString());
            return ResponseEntity.status(response.statusCode()).body(response.body());
        } catch (Exception failure) {
            throw new AssertionError(failure);
        }
    }

    @Test
    void allEventKindsAndIdsReachSharedLedgerAndIngressReplayRetainsOriginalNonce() throws Exception {
        String payload = """
                {"destination":"Udestination","events":[
                {"type":"message","webhookEventId":"event-1","message":{"id":"message-1","type":"text","text":"hello"},"source":{"type":"user","userId":"U1"}},
                {"type":"follow","webhookEventId":"event-2","source":{"type":"user","userId":"U1"}},
                {"type":"unfollow","webhookEventId":"event-3"},
                {"type":"join","webhookEventId":"event-4","source":{"type":"group","groupId":"G1"}},
                {"type":"leave","webhookEventId":"event-5","source":{"type":"room","roomId":"R1"}},
                {"type":"memberJoined","webhookEventId":"event-6"},
                {"type":"memberLeft","webhookEventId":"event-7"},
                {"type":"postback","webhookEventId":"event-8","postback":{"data":"preserve"}},
                {"type":"beacon","webhookEventId":"event-9"},
                {"type":"accountLink","webhookEventId":"event-10"},
                {"type":"things","webhookEventId":"event-11"},
                {"type":"videoPlayComplete","webhookEventId":"event-12"},
                {"type":"unsend","webhookEventId":"event-13","unsend":{"messageId":"message-1"}}]}
                """;
        String raw = Base64.getEncoder().encodeToString(payload.getBytes(StandardCharsets.UTF_8));
        byte[] ingress = codec.fresh(raw);
        String nonce = mapper.readTree(ingress).path("nonce").textValue();
        AtomicInteger sharedLedgerCalls = new AtomicInteger();
        when(transport.post(any(), any())).thenAnswer(invocation -> {
            byte[] forwarded = invocation.getArgument(1);
            assertEquals(raw, codec.verify(forwarded));
            assertEquals(nonce, mapper.readTree(forwarded).path("nonce").textValue());
            assertArrayEquals(ingress, forwarded);
            int call = sharedLedgerCalls.incrementAndGet();
            return new AppsScriptClient.Response(200, (call == 1
                    ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"REPLAY\"}").getBytes(StandardCharsets.UTF_8));
        });
        for (int duplicate = 0; duplicate < 2; duplicate++) {
            ResponseEntity<String> response = post(ingress);
            assertEquals(duplicate == 0 ? HttpStatus.OK : HttpStatus.BAD_GATEWAY, response.getStatusCode());
            assertEquals(duplicate == 0, mapper.readTree(response.getBody()).path("ok").booleanValue());
        }
        assertEquals(2, sharedLedgerCalls.get());
    }

    @Test
    void rejectsUnauthenticatedBeforeForwardAndSanitizesUpstreamErrors() throws Exception {
        clearInvocations(transport);
        assertEquals(HttpStatus.UNAUTHORIZED, post("{\"events\":[]}".getBytes(StandardCharsets.UTF_8)).getStatusCode());
        var tampered = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(codec.fresh("eyJldmVudHMiOltdfQ=="));
        tampered.put("rawBody", "eyJldmVudHMiOlt7fV19");
        assertEquals(HttpStatus.UNAUTHORIZED, post(mapper.writeValueAsBytes(tampered)).getStatusCode());
        tampered.remove("timestamp");
        assertEquals(HttpStatus.UNAUTHORIZED, post(mapper.writeValueAsBytes(tampered)).getStatusCode());
        verifyNoInteractions(transport);
        when(transport.post(any(), any())).thenReturn(new AppsScriptClient.Response(200,
                "{\"ok\":false,\"error\":\"PRIVATE_UPSTREAM_DETAIL\"}".getBytes(StandardCharsets.UTF_8)));
        ResponseEntity<String> response = post(codec.fresh("eyJldmVudHMiOltdfQ=="));
        assertEquals(HttpStatus.BAD_GATEWAY, response.getStatusCode());
        assertFalse(response.getBody().contains("PRIVATE"));
        assertEquals("UPSTREAM_FAILED", mapper.readTree(response.getBody()).path("error").textValue());
    }

    @Test
    void boundsIngressBody() {
        clearInvocations(transport);
        assertEquals(413, post(new byte[EnvelopeCodec.MAX_ENVELOPE + 1]).getStatusCode().value());
        verifyNoInteractions(transport);
    }
}
