# The alerts mail receiver

`server/cmd/alerts-mail` is the receiver of `docs/protocol.md` §26: an SMTP listener for the alerts mail domain
(`alerts.allmymind.org` on the VPS). A family forwards its card alerts from Gmail to its address,
`<token>@alerts.allmymind.org`; the receiver reads each mail in memory, posts only the parsed facts to the backend's
`POST /api/alerts/inbound`, and keeps nothing of the mail.

## What it does

- Listens on port 25 only. With a certificate configured it offers STARTTLS; it offers no AUTH and relays nothing.
- `RCPT TO` is taken only at the alerts domain, and only when the local part is a token a family owns: it asks the
  backend once (`GET /api/alerts/inbound/{token}`, with the shared secret). Another domain is refused `550 5.7.1`; an
  unknown token `550 5.1.1`; a backend that does not answer `451` (the sender tries again later).
- A mail over 1 MiB is refused `552` (at `MAIL FROM` when the sender declares its size, else while it is sent). At
  most 5 recipients a mail; a connection idle for 2 minutes is closed.
- Each mail is parsed in memory into one alert and posted once per family it was sent to:
  - Chase and Citi charge alerts: `charge` with `amount`, `merchant`, `last4` and `when` (the mail's ET time).
  - PNC's "You sent a Zelle payment to ..." mail (from pnc.com): `zelle-sent` with the payee as `merchant`, `amount`,
    the account's `last4`, the payment date as `when` and the `memo`; PNC's "A $X deposit was credited to your
    account." mail: `deposit` with the payer ("Deposit made by") as `merchant`, `amount`, `last4` and the date as
    `when`. The transaction id is never kept. Any other PNC mail is `unread`.
  - Amazon order and shipment mails: `amazon` with the total as `amount`, `merchant` "Amazon" and the mail's date.
    The order id and items are read too, but §26 has no field for them, so they are not posted.
  - Gmail's forwarding confirmation (subject `(Gmail Forwarding Confirmation - Receive Mail from ...`, from
    google.com): `forward-confirm` with its `link`, the `https://mail.google.com/mail/vf-...` one, which the family's
    app shows to tap and confirm. Gmail's real mail has a confirm link and a cancel link (`.../uf-...`) and no code;
    a code (`(#123456789)` in the subject or `Confirmation code:` in the body) is read too, should one come. A mail
    from any other domain, a link on any other host or path, and the cancel link are never kept: the mail is `unread`.
  - Subsplash notes mail (a church's "Notes for "The Day of the Lord" - 2 Peter 3:10-18", from subsplash.com):
    `sermon-notes` with the `title` and `reference` from the subject and the date a line of the body gives as `when`
    (midnight Eastern; the mail's own Date when no line is a date). The body is read for that date and nothing else;
    the attached notes PDF, like every attachment, is skipped unread and never kept. A "Notes for ..." subject from
    any other domain is `unread`.
  - Anything else: `unread` with its subject only.
- Nothing is written to disk: no queue, no spool, no mail in the log. The log says only that an alert of a kind was
  posted, or why one was not.

## A second token, for sermon notes

The sermon-notes reader (sermon-index) is a licensed key of its own, so it is a family of its own
(`docs/protocol.md` §26) with its own `<token>@alerts.allmymind.org`. The receiver is the same, with no new
domain, certificate or daemon: a Gmail filter forwards the Subsplash notes mail to that address, and the bank
filters keep forwarding to the family's. A family's token is the only thing that routes a mail, so a notes mail sent to
the bank token would be listed in the bank feed and a bank mail sent to the sermon token in the reader's: the
filters decide. The reader claims only its own alerts.

The parsers were built from mails printed from Gmail, so the first real forwarded mail of each kind is the one to
check them against (`journalctl -u alerts-mail` says `posted a charge alert`, not `posted a unread alert`).

It does not check SPF or DKIM: the token is what keeps strangers out, so a mail forged to look like a bank's and
sent to a family's address would be listed as a charge. It keeps no per-sender rate limit.

## Install on the VPS

These are the steps, in order. `alerts.allmymind.org` and the VPS's address are the live values; the secret is new.

1. **The backend.** The backend's env file must set `POSTERN_ALERTS_DOMAIN=alerts.allmymind.org` and
   `POSTERN_ALERTS_SECRET` (make one with `openssl rand -hex 32`); restart the backend after setting them. Check:
   `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $SECRET" http://127.0.0.1:8787/api/alerts/inbound/aaaaaaaaaaaa`
   prints `404` (not `501`, not `401`).

2. **The binary.** On the Laptop, in `server/`:
   `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o alerts-mail ./cmd/alerts-mail`, then copy it to the VPS as
   `/usr/local/bin/alerts-mail` (`sudo install -m 0755 alerts-mail /usr/local/bin/alerts-mail`).

3. **DNS.** At the DNS provider for `allmymind.org`, add:

   ```
   alerts.allmymind.org.   A    <the VPS's IPv4 address>
   alerts.allmymind.org.   MX   10 alerts.allmymind.org.
   alerts.allmymind.org.   TXT  "v=spf1 -all"
   ```

   The MX names a host with an A record (never a CNAME). The TXT says the domain sends no mail. Check:
   `dig +short MX alerts.allmymind.org` prints `10 alerts.allmymind.org.`.

4. **The certificate.** Once the A record answers: `sudo certbot certonly --nginx -d alerts.allmymind.org`. The
   files are `/etc/letsencrypt/live/alerts.allmymind.org/fullchain.pem` and `privkey.pem`. The unit below loads them
   as credentials when it starts, so a renewal restarts it: put this in
   `/etc/letsencrypt/renewal-hooks/deploy/alerts-mail.sh` (mode 0755):

   ```sh
   #!/bin/sh
   case "$RENEWED_DOMAINS" in *alerts.allmymind.org*) systemctl restart alerts-mail ;; esac
   ```

5. **The env file.** `/etc/postern/alerts-mail.env`, owned by root, mode 0600:

   ```
   POSTERN_ALERTS_DOMAIN=alerts.allmymind.org
   POSTERN_ALERTS_SECRET=<the same secret as the backend's>
   POSTERN_ALERTS_MAIL_BACKEND=http://127.0.0.1:8787
   POSTERN_ALERTS_MAIL_HOSTNAME=alerts.allmymind.org
   ```

   `POSTERN_ALERTS_MAIL_BACKEND` is where the backend listens (its `POSTERN_ADDR`). `POSTERN_ALERTS_MAIL_ADDR`
   (default `:25`) and the two TLS paths (set by the unit) are the other settings.

6. **The unit.** `/etc/systemd/system/alerts-mail.service`:

   ```ini
   [Unit]
   Description=Postern alerts mail receiver
   After=network-online.target
   Wants=network-online.target

   [Service]
   ExecStart=/usr/local/bin/alerts-mail
   EnvironmentFile=/etc/postern/alerts-mail.env
   LoadCredential=cert:/etc/letsencrypt/live/alerts.allmymind.org/fullchain.pem
   LoadCredential=key:/etc/letsencrypt/live/alerts.allmymind.org/privkey.pem
   Environment=POSTERN_ALERTS_MAIL_TLS_CERT=%d/cert
   Environment=POSTERN_ALERTS_MAIL_TLS_KEY=%d/key
   DynamicUser=yes
   AmbientCapabilities=CAP_NET_BIND_SERVICE
   CapabilityBoundingSet=CAP_NET_BIND_SERVICE
   NoNewPrivileges=yes
   ProtectSystem=strict
   ProtectHome=yes
   PrivateTmp=yes
   PrivateDevices=yes
   ProtectKernelTunables=yes
   ProtectKernelModules=yes
   ProtectControlGroups=yes
   RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
   MemoryMax=256M
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

   It runs as a user made for it, may bind port 25 and nothing more, and has no writable path. Then:
   `sudo systemctl daemon-reload && sudo systemctl enable --now alerts-mail`. Check:
   `journalctl -u alerts-mail -n 5` shows `taking mail for alerts.allmymind.org on :25 (STARTTLS true)`.

7. **The firewall.** Open inbound TCP 25 and nothing else new: at the VPS provider's firewall, a rule
   `allow inbound TCP 25 from anywhere (IPv4 and IPv6)`; on the VPS, if ufw is on, `sudo ufw allow 25/tcp`. The
   backend stays on loopback. Check, from the Laptop:
   `openssl s_client -starttls smtp -connect alerts.allmymind.org:25 -servername alerts.allmymind.org </dev/null`
   shows the certificate for `alerts.allmymind.org`.

8. **The first mail.** The family adds its address in Gmail (Settings, Forwarding and POP/IMAP, Add a forwarding
   address). Gmail's confirmation mail reaches the receiver; the family's app shows its code. `journalctl -u
   alerts-mail` says `posted a forward-confirm alert`.

## The way back

1. `sudo systemctl disable --now alerts-mail`: port 25 closes and no mail is taken.
2. Remove the MX record for `alerts.allmymind.org` (and its A and TXT records if nothing else uses them).
3. Close TCP 25 at the provider's firewall, and `sudo ufw delete allow 25/tcp` if it was added.
4. To remove it entirely: `sudo rm /etc/systemd/system/alerts-mail.service /usr/local/bin/alerts-mail
   /etc/postern/alerts-mail.env /etc/letsencrypt/renewal-hooks/deploy/alerts-mail.sh && sudo systemctl daemon-reload`.
5. Tell the family to delete the Gmail filter and forwarding address: Gmail's forwards to an address that no longer
   takes mail come back to them as bounces.

The backend's alerts keep working without the receiver; only new mail stops. Its alerts are dropped after 30 days.
