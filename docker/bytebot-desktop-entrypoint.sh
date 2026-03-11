#!/bin/sh
set -eu

write_user_prefs() {
  profile_dir="$1"
  cat > "${profile_dir}/user.js" <<'EOF'
user_pref("cookiebanners.service.mode", 2);
user_pref("cookiebanners.service.mode.privateBrowsing", 2);
user_pref("cookiebanners.bannerClicking.enabled", true);
user_pref("cookiebanners.service.enableGlobalRules", true);
user_pref("cookiebanners.service.enableGlobalRules.subFrames", true);
user_pref("browser.translations.enable", false);
user_pref("browser.translations.automaticallyPopup", false);
EOF
  chown user:user "${profile_dir}/user.js" 2>/dev/null || true
  chmod 644 "${profile_dir}/user.js" 2>/dev/null || true
}

seed_existing_profiles() {
  for root in /home/user/.mozilla/firefox-esr /home/user/.mozilla/firefox; do
    if [ ! -d "$root" ]; then
      continue
    fi

    find "$root" -maxdepth 1 -type d \( -name "*.default*" -o -name "*.default-esr*" -o -name "*.default-release*" \) | while read -r profile; do
      write_user_prefs "$profile"
    done
  done
}

seed_existing_profiles

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf -n
