FROM ghcr.io/bytebot-ai/bytebot-desktop:edge

COPY packages/bytebotd/root/usr/lib/firefox-esr/defaults/pref/bytebot-firefox.js /usr/lib/firefox-esr/defaults/pref/bytebot-firefox.js
COPY docker/bytebot-desktop-entrypoint.sh /usr/local/bin/bytebot-desktop-entrypoint.sh

RUN chmod 755 /usr/local/bin/bytebot-desktop-entrypoint.sh

# Expose the bytebotd service port
EXPOSE 9990

ENTRYPOINT ["/usr/local/bin/bytebot-desktop-entrypoint.sh"]
