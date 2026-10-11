package org.phcep.adapter;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import org.junit.jupiter.api.Test;

class EnvelopeCodecTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final Clock clock = Clock.fixed(Instant.ofEpochMilli(1_800_000_000_000L), ZoneOffset.UTC);
    private final EnvelopeCodec codec = new EnvelopeCodec(mapper, "test-only-gateway-key-with-32-bytes", clock);
    private final String raw = Base64.getEncoder().encodeToString("{\"events\":[]}".getBytes(StandardCharsets.UTF_8));

    @Test
    void verifiesAndPreservesBytes() throws Exception {
        assertEquals(raw, codec.verify(codec.fresh(raw)));
    }

    @Test
    void refusesMissingFieldsAndWrongTypes() throws Exception {
        ObjectNode original = (ObjectNode) mapper.readTree(codec.fresh(raw));
        for (String field : new String[]{"version", "action", "timestamp", "nonce", "rawBody", "signature"}) {
            ObjectNode missing = original.deepCopy();
            missing.remove(field);
            assertThrows(EnvelopeCodec.InvalidEnvelope.class, () -> codec.verify(mapper.writeValueAsBytes(missing)));
        }
        for (String timestamp : new String[]{"\"1800000000000\"", "1800000000000.0", "null", "true",
                "999999999999999999999999", "0", "-9223372036854775808"}) {
            ObjectNode wrong = original.deepCopy();
            wrong.set("timestamp", mapper.readTree(timestamp));
            assertThrows(EnvelopeCodec.InvalidEnvelope.class, () -> codec.verify(mapper.writeValueAsBytes(wrong)));
        }
    }

    @Test
    void rejectsTamperingDuplicateFieldsAndInvalidBase64() throws Exception {
        ObjectNode original = (ObjectNode) mapper.readTree(codec.fresh(raw));
        for (String field : new String[]{"action", "nonce", "rawBody", "signature"}) {
            ObjectNode changed = original.deepCopy();
            changed.put(field, "tampered");
            assertThrows(EnvelopeCodec.InvalidEnvelope.class, () -> codec.verify(mapper.writeValueAsBytes(changed)));
        }
        ObjectNode changed = original.deepCopy();
        changed.put("timestamp", clock.millis() + 1);
        assertThrows(EnvelopeCodec.InvalidEnvelope.class, () -> codec.verify(mapper.writeValueAsBytes(changed)));
        String json = mapper.writeValueAsString(original);
        assertThrows(EnvelopeCodec.InvalidEnvelope.class,
                () -> codec.verify(json.replace("{", "{\"version\":1,").getBytes(StandardCharsets.UTF_8)));
        assertThrows(EnvelopeCodec.InvalidEnvelope.class,
                () -> codec.verify((json + "{}").getBytes(StandardCharsets.UTF_8)));
        for (String invalid : new String[]{"!!!", "YQ", "YR==", "YQ==\n"}) {
            assertThrows(EnvelopeCodec.InvalidEnvelope.class, () -> codec.verify(codec.fresh(invalid)));
        }
        String oversized = Base64.getEncoder().encodeToString(new byte[EnvelopeCodec.MAX_PAYLOAD + 1]);
        assertThrows(EnvelopeCodec.InvalidEnvelope.class, () -> codec.verify(codec.fresh(oversized)));
    }

    @Test
    void rejectsExpiredAndDifferentKey() throws Exception {
        EnvelopeCodec old = new EnvelopeCodec(mapper, "test-only-gateway-key-with-32-bytes",
                Clock.offset(clock, java.time.Duration.ofMinutes(-6)));
        assertThrows(EnvelopeCodec.InvalidEnvelope.class, () -> codec.verify(old.fresh(raw)));
        EnvelopeCodec other = new EnvelopeCodec(mapper, "another-test-only-gateway-key-32-bytes", clock);
        assertThrows(EnvelopeCodec.InvalidEnvelope.class, () -> codec.verify(other.fresh(raw)));
    }

    @Test
    void acceptsExactlyOneMiBAndRejectsWrongVersionExtraFieldsAndMalformedUuid() throws Exception {
        String maximum = Base64.getEncoder().encodeToString(("{\"events\":[]}"
                + " ".repeat(EnvelopeCodec.MAX_PAYLOAD - 13)).getBytes(StandardCharsets.UTF_8));
        assertEquals(maximum, codec.verify(codec.fresh(maximum)));
        ObjectNode original = (ObjectNode) mapper.readTree(codec.fresh(raw));
        for (String version : new String[]{"\"1\"", "1.0", "2", "null"}) {
            ObjectNode wrong = original.deepCopy();
            wrong.set("version", mapper.readTree(version));
            assertThrows(EnvelopeCodec.InvalidEnvelope.class, () -> codec.verify(mapper.writeValueAsBytes(wrong)));
        }
        original.put("extra", "field");
        assertThrows(EnvelopeCodec.InvalidEnvelope.class, () -> codec.verify(mapper.writeValueAsBytes(original)));
        original.remove("extra");
        for (String nonce : new String[]{"1-1-1-1-1", "f959d6c9-0230-0474-9d26-0491e6b91539",
                "f959d6c9-0230-4474-1d26-0491e6b91539"}) {
            original.put("nonce", nonce);
            assertThrows(EnvelopeCodec.InvalidEnvelope.class, () -> codec.verify(mapper.writeValueAsBytes(original)));
        }
    }

    @Test
    void rejectsInvalidPayloadShapeAndTooManyEventsAfterAuthentication() throws Exception {
        for (String payload : new String[]{"{}", "{\"events\":{}}", "{\"events\":null}",
                "{\"events\":[" + "{},".repeat(100) + "{}]}", "{\"events\":[]}{}"}) {
            String encoded = Base64.getEncoder().encodeToString(payload.getBytes(StandardCharsets.UTF_8));
            assertThrows(EnvelopeCodec.InvalidEnvelope.class, () -> codec.verify(codec.fresh(encoded)));
        }
        String encoded = Base64.getEncoder().encodeToString(
                ("{\"events\":[" + "{},".repeat(99) + "{}]}").getBytes(StandardCharsets.UTF_8));
        assertEquals(encoded, codec.verify(codec.fresh(encoded)));
    }
}
