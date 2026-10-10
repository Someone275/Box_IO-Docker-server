# Included at the top of the BlueOnyx virtual site for the dashboard.
# The Box IO container listens on 127.0.0.1:3847.
# These rules run before a site-wide HTTP-to-HTTPS redirect, so the phone
# and Windows apps receive JSON instead of an HTML redirect page.

RewriteEngine On
RewriteRule ^/api/ http://127.0.0.1:3847%{REQUEST_URI} [P,L]
RewriteRule ^/public/ http://127.0.0.1:3847%{REQUEST_URI} [P,L]
RewriteRule ^/hw/ http://127.0.0.1:3847%{REQUEST_URI} [P,L]
RewriteRule ^/ws http://127.0.0.1:3847%{REQUEST_URI} [P,L]

ProxyPreserveHost On
ProxyTimeout 60

ProxyPass        /api/ http://127.0.0.1:3847/api/ retry=0 timeout=60
ProxyPassReverse /api/ http://127.0.0.1:3847/api/

ProxyPass        /ws ws://127.0.0.1:3847/ws retry=0 timeout=3600
ProxyPassReverse /ws ws://127.0.0.1:3847/ws

ProxyPass        / http://127.0.0.1:3847/ retry=0 timeout=60
ProxyPassReverse / http://127.0.0.1:3847/
