package org.phcep.adapter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

final class EnvelopeCodec {
    static final int MAX_PAYLOAD = 1024 * 1024;
    static final int MAX_ENVELOPE = 1_400_000;
    static final long MAX_SKEW_MS = 300_000;
    private final ObjectMapper mapper;
    private final byte[] secret;
    private final Clock clock;

    EnvelopeCodec(ObjectMapper mapper, String secret, Clock clock) {
        this.mapper = mapper;
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        this.clock = clock;
    }

    String verify(byte[] body) throws InvalidEnvelope {
        try {
            if (body.length > MAX_ENVELOPE) {
                throw new InvalidEnvelope();
            }
            JsonNode node = mapper.reader()
                    .with(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
                    .with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readTree(body);
            if (node == null || !node.isObject() || node.size() != 6
                    || !node.path("version").isIntegralNumber() || !node.path("version").canConvertToInt()
                    || node.path("version").intValue() != 1
                    || !node.path("action").isTextual() || !"events".equals(node.path("action").textValue())
                    || !node.path("timestamp").isIntegralNumber() || !node.path("timestamp").canConvertToLong()
                    || !node.path("nonce").isTextual() || !node.path("rawBody").isTextual()
                    || !node.path("signature").isTextual()) {
                throw new InvalidEnvelope();
            }
            long timestamp = node.path("timestamp").longValue();
            long now = clock.millis();
            if (timestamp < now - MAX_SKEW_MS || timestamp > now + MAX_SKEW_MS) {
                throw new InvalidEnvelope();
            }
            String nonce = node.path("nonce").textValue();
            if (!nonce.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}")) {
                throw new InvalidEnvelope();
            }
            String rawBody = node.path("rawBody").textValue();
            byte[] signature = decode(node.path("signature").textValue(), 32);
            if (signature.length != 32 || !MessageDigest.isEqual(signature, sign(timestamp, nonce, rawBody))) {
                throw new InvalidEnvelope();
            }
            byte[] payload = decode(rawBody, MAX_PAYLOAD);
            JsonNode line = mapper.reader()
                    .with(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
                    .with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readTree(payload);
            if (line == null || !line.isObject() || !line.path("events").isArray()
                    || line.path("events").size() > 100) {
                throw new InvalidEnvelope();
            }
            // Validate the authenticated payload shape without reserializing original bytes.
            return rawBody;
        } catch (InvalidEnvelope e) {
            throw e;
        } catch (Exception e) {
            throw new InvalidEnvelope();
        }
    }

    byte[] fresh(String rawBody) throws Exception {
        long timestamp = clock.millis();
        String nonce = UUID.randomUUID().toString();
        var node = mapper.createObjectNode();
        node.put("version", 1).put("action", "events").put("timestamp", timestamp)
                .put("nonce", nonce).put("rawBody", rawBody)
                .put("signature", Base64.getEncoder().encodeToString(sign(timestamp, nonce, rawBody)));
        return mapper.writeValueAsBytes(node);
    }

    private byte[] sign(long timestamp, String nonce, String rawBody) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret, "HmacSHA256"));
        return mac.doFinal(("1\nevents\n" + timestamp + "\n" + nonce + "\n" + rawBody)
                .getBytes(StandardCharsets.UTF_8));
    }

    private byte[] decode(String value, int limit) throws InvalidEnvelope {
        if (value.length() > ((limit + 2L) / 3) * 4) {
            throw new InvalidEnvelope();
        }
        try {
            byte[] decoded = Base64.getDecoder().decode(value);
            if (decoded.length > limit || !Base64.getEncoder().encodeToString(decoded).equals(value)) {
                throw new InvalidEnvelope();
            }
            return decoded;
        } catch (IllegalArgumentException e) {
            throw new InvalidEnvelope();
        }
    }

    static final class InvalidEnvelope extends Exception {}
}
