package org.phcep.adapter;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.http.HttpClient;
import java.time.Clock;
import java.time.Duration;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.Environment;

@SpringBootApplication
public class AdapterApplication {
    public static void main(String[] args) {
        SpringApplication.run(AdapterApplication.class, args);
    }

    @Bean
    EnvelopeCodec envelopeCodec(ObjectMapper mapper, Environment environment) {
        String gateway = environment.getProperty("GATEWAY_SIGNING_SECRET");
        String line = environment.getProperty("LINE_CHANNEL_SECRET");
        if (gateway == null || gateway.length() < 32
                || gateway.getBytes(java.nio.charset.StandardCharsets.UTF_8).length < 32
                || line == null || line.isBlank() || gateway.equals(line)) {
            throw new IllegalStateException("Distinct gateway and LINE secrets must be configured");
        }
        return new EnvelopeCodec(mapper, gateway, Clock.systemUTC());
    }

    @Bean
    AppsScriptClient.Transport googleTransport() {
        return new GoogleTransport(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER).build());
    }

    @Bean
    AppsScriptClient appsScriptClient(ObjectMapper mapper, Environment environment,
            AppsScriptClient.Transport transport) {
        return new AppsScriptClient(mapper,
                GoogleTransport.endpoint(environment.getProperty("PHCEP_APPS_SCRIPT_URL")),
                transport);
    }
}
