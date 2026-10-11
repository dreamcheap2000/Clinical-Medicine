package org.phcep.adapter;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;

final class GoogleTransport implements AppsScriptClient.Transport {
    static final int MAX_RESPONSE = 64 * 1024;
    private final HttpClient client;

    GoogleTransport(HttpClient client) {
        if (client.followRedirects() != HttpClient.Redirect.NEVER) {
            throw new IllegalArgumentException("Automatic redirects must be disabled");
        }
        this.client = client;
    }

    static URI endpoint(String value) {
        if (value == null || !value.matches("https://script\\.google\\.com/macros/s/[A-Za-z0-9_-]+/exec")) {
            throw new IllegalArgumentException("A canonical Apps Script HTTPS deployment URL is required");
        }
        return URI.create(value);
    }

    static URI redirect(String value) {
        URI uri;
        try {
            uri = URI.create(value);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid Apps Script redirect");
        }
        if (!"https".equals(uri.getScheme()) || !"script.googleusercontent.com".equals(uri.getHost())
                || uri.getPort() != -1 || uri.getUserInfo() != null || uri.getFragment() != null
                || !"/macros/echo".equals(uri.getRawPath())) {
            throw new IllegalArgumentException("Invalid Apps Script redirect");
        }
        return uri;
    }

    @Override
    public AppsScriptClient.Response post(URI endpoint, byte[] envelope) throws Exception {
        endpoint(endpoint.toString());
        HttpResponse<byte[]> response = send(HttpRequest.newBuilder(endpoint)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(envelope)).build());
        if (response.statusCode() == 302 || response.statusCode() == 303) {
            URI location = redirect(response.headers().firstValue("Location").orElse(""));
            // ContentService redirects expose a result URL; credentials and signed body must never follow it.
            response = send(HttpRequest.newBuilder(location).GET().build());
        }
        return new AppsScriptClient.Response(response.statusCode(), response.body());
    }

    private HttpResponse<byte[]> send(HttpRequest request) throws Exception {
        var timed = HttpRequest.newBuilder(request, (name, value) -> true)
                .timeout(Duration.ofSeconds(10)).build();
        var future = client.sendAsync(timed, info -> new LimitedBodySubscriber());
        try {
            return future.get(10, TimeUnit.SECONDS);
        } finally {
            future.cancel(true);
        }
    }

    static final class LimitedBodySubscriber implements HttpResponse.BodySubscriber<byte[]> {
        private final HttpResponse.BodySubscriber<byte[]> delegate = HttpResponse.BodySubscribers.ofByteArray();
        private Flow.Subscription subscription;
        private long size;

        @Override
        public CompletionStage<byte[]> getBody() { return delegate.getBody(); }
        @Override
        public void onSubscribe(Flow.Subscription value) {
            subscription = value;
            delegate.onSubscribe(value);
        }
        @Override
        public void onNext(List<ByteBuffer> buffers) {
            for (ByteBuffer buffer : buffers) {
                size += buffer.remaining();
            }
            if (size > MAX_RESPONSE) {
                subscription.cancel();
                delegate.onError(new IllegalStateException("Upstream response limit exceeded"));
            } else {
                delegate.onNext(buffers);
            }
        }
        @Override
        public void onError(Throwable error) { delegate.onError(error); }
        @Override
        public void onComplete() { delegate.onComplete(); }
    }
}
