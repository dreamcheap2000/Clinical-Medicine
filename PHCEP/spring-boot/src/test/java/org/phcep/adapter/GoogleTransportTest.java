package org.phcep.adapter;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Flow;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class GoogleTransportTest {
    @Test
    void rejectsSsrfEndpointsAndRedirects() {
        for (String url : new String[]{"http://script.google.com/macros/s/id/exec",
                "https://script.google.com.evil/macros/s/id/exec", "https://script.google.com/macros/s/id/exec?secret=x",
                "https://user@script.google.com/macros/s/id/exec", "https://script.google.com:443/macros/s/id/exec",
                "https://script.google.com/macros/s/id/exec/", "https://127.0.0.1/macros/s/id/exec"}) {
            assertThrows(IllegalArgumentException.class, () -> GoogleTransport.endpoint(url));
        }
        for (String url : new String[]{"https://evil.example/macros/echo", "http://script.googleusercontent.com/macros/echo",
                "https://script.googleusercontent.com:443/macros/echo", "https://user@script.googleusercontent.com/macros/echo",
                "https://script.googleusercontent.com/macros/echo#fragment", "https://script.googleusercontent.com/elsewhere"}) {
            assertThrows(IllegalArgumentException.class, () -> GoogleTransport.redirect(url));
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void contentServiceRedirectIsBodylessGetWithNoCredentials() throws Exception {
        HttpClient http = mock(HttpClient.class);
        when(http.followRedirects()).thenReturn(HttpClient.Redirect.NEVER);
        HttpResponse<byte[]> redirect = mock(HttpResponse.class);
        when(redirect.statusCode()).thenReturn(302);
        when(redirect.headers()).thenReturn(HttpHeaders.of(
                Map.of("Location", List.of("https://script.googleusercontent.com/macros/echo?user_content_key=test")),
                (name, value) -> true));
        HttpResponse<byte[]> success = mock(HttpResponse.class);
        when(success.statusCode()).thenReturn(200);
        when(success.body()).thenReturn("{\"ok\":true}".getBytes());
        when(http.sendAsync(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenReturn(CompletableFuture.completedFuture(redirect), CompletableFuture.completedFuture(success));
        assertEquals(200, new GoogleTransport(http).post(
                GoogleTransport.endpoint("https://script.google.com/macros/s/id/exec"), new byte[]{1, 2, 3}).status());
        ArgumentCaptor<HttpRequest> requests = ArgumentCaptor.forClass(HttpRequest.class);
        verify(http, times(2)).sendAsync(requests.capture(), any(HttpResponse.BodyHandler.class));
        HttpRequest get = requests.getAllValues().get(1);
        assertEquals("GET", get.method());
        assertTrue(get.bodyPublisher().isEmpty());
        assertTrue(get.headers().map().isEmpty());
        assertEquals(URI.create("https://script.googleusercontent.com/macros/echo?user_content_key=test"), get.uri());
        assertTrue(get.timeout().isPresent());
    }

    @Test
    void responseSubscriberCancelsOversizedBody() {
        GoogleTransport.LimitedBodySubscriber subscriber = new GoogleTransport.LimitedBodySubscriber();
        Flow.Subscription subscription = mock(Flow.Subscription.class);
        subscriber.onSubscribe(subscription);
        subscriber.onNext(List.of(ByteBuffer.wrap(new byte[GoogleTransport.MAX_RESPONSE + 1])));
        verify(subscription).cancel();
        assertThrows(java.util.concurrent.CompletionException.class, () -> subscriber.getBody().toCompletableFuture().join());
    }
}
