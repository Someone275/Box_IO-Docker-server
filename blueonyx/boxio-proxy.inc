# Included from the BlueOnyx virtual site that should show the dashboard.
# The Box IO container listens on 127.0.0.1:3847.

ProxyPreserveHost On
ProxyTimeout 60

ProxyPass        /ws ws://127.0.0.1:3847/ws retry=0 timeout=3600
ProxyPassReverse /ws ws://127.0.0.1:3847/ws

ProxyPass        / http://127.0.0.1:3847/ retry=0 timeout=60
ProxyPassReverse / http://127.0.0.1:3847/
