FROM ghcr.io/bytebot-ai/bytebot-desktop:edge

COPY desktop-files/bytebot-firefox.js /usr/lib/firefox-esr/defaults/pref/bytebot-firefox.js
COPY bytebot-desktop-entrypoint.sh /usr/local/bin/bytebot-desktop-entrypoint.sh

RUN chmod 755 /usr/local/bin/bytebot-desktop-entrypoint.sh

EXPOSE 9990

ENTRYPOINT ["/usr/local/bin/bytebot-desktop-entrypoint.sh"]
