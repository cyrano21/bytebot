FROM ghcr.io/berriai/litellm:main-stable

# Add custom config into the image
COPY ./bytebot-llm-proxy/litellm-config.yaml /app/config.yaml

ENV PORT=4000
CMD ["--config", "/app/config.yaml", "--port", "4000"]