# Box IO Docker server

Prebuilt image for the Box IO station. Arduino and ESP32 boards call the device hub on port **5923**. The dashboard is HTTPS on port **443**.

The image name is `box_io-docker-server`. Release **v1.0.0** is that image, already built. Load it with Docker. The server does not compile Node.

```bash
curl -fL -o box_io-docker-server.tar.gz \
  https://github.com/Someone275/Box_IO-Docker-server/releases/download/v1.0.0/box_io-docker-server.tar.gz
docker load -i box_io-docker-server.tar.gz
```

`docker load` creates `ghcr.io/someone275/box_io-docker-server:latest` and `:1.0.0`. After you upload the same image to Docker Hub, `docker pull YOUR_USER/box_io-docker-server:latest` is the other way to get it. [Upload the image to Docker Hub](#upload-the-image-to-docker-hub) is at the bottom of this file.

| Port | Use |
| --- | --- |
| **5923** | HTTP for Arduino, ESP32, and other boards |
| **80** | Redirects to HTTPS, and the Let’s Encrypt check |
| **443** | Web dashboard |
| **3847** | Dashboard API inside Docker. On BlueOnyx only, published on `127.0.0.1` |

Pick the page for the machine you are installing:

- [Ubuntu](#ubuntu)
- [CentOS](#centos)
- [Red Hat Enterprise Linux](#red-hat-enterprise-linux)
- [BlueOnyx](#blueonyx)

Then use [Start Box IO](#start-box-io) on Ubuntu, CentOS, and Red Hat. BlueOnyx has its own start steps because the panel already listens on ports 80 and 443.

Do not put SSH passwords, the JWT secret, SMTP passwords, or Twilio tokens in git.

## Ubuntu

Ubuntu 24.04. The SSH user in the examples is `user`. Use the account on your machine.

### 1. DNS and ports

Create an **A** record for the dashboard name, such as `boxio.example.com`, pointing at the router’s public WAN address. Forward TCP **80**, **443**, and **5923** to this machine. UDP is not required.

### 2. Update Ubuntu

```bash
sudo apt update
sudo apt upgrade -y
```

### 3. Install Docker Engine

```bash
sudo apt install -y ca-certificates curl git ufw
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a644 /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo ${UBUNTU_CODENAME:-$VERSION_CODENAME}) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker user
```

Sign out and back in so the docker group applies. `docker version` and `docker compose version` should both print a version.

### 4. Open the firewall

Allow SSH before you enable the firewall.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 5923/tcp
sudo ufw enable
sudo ufw status
```

Continue at [Start Box IO](#start-box-io).

## CentOS

CentOS Stream 9 or CentOS Stream 10. The commands use `dnf` and firewalld.

### 1. DNS and ports

Create an **A** record for `boxio.example.com` pointing at the public WAN address. Forward TCP **80**, **443**, and **5923** to this machine.

### 2. Update CentOS

```bash
sudo dnf -y upgrade
```

### 3. Install Docker Engine

```bash
sudo dnf -y install dnf-plugins-core git
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker user
```

Sign out and back in. `docker version` and `docker compose version` should both print a version.

If `dnf` cannot find `docker-ce`, the Docker CentOS repository has no build for that exact `$releasever`. Check the folders at `https://download.docker.com/linux/centos/` and use a CentOS Stream release listed there.

### 4. Open firewalld

SELinux can stay enforcing. The compose file labels the nginx files so the container can read them.

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=5923/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-all
```

Continue at [Start Box IO](#start-box-io).

## Red Hat Enterprise Linux

Red Hat Enterprise Linux 8, 9, or 10. The host needs a current Red Hat subscription so `dnf` can install packages. This installs Docker Engine from Docker’s RHEL repository. Leave SELinux enforcing.

### 1. DNS and ports

Create an **A** record for `boxio.example.com` pointing at the public WAN address. Forward TCP **80**, **443**, and **5923** to this machine.

### 2. Update Red Hat

```bash
sudo dnf -y upgrade
```

### 3. Install Docker Engine

```bash
sudo dnf -y install dnf-plugins-core git
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker user
```

Sign out and back in.

```bash
docker version
docker compose version
getenforce
```

`getenforce` should print `Enforcing`.

### 4. Open firewalld

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=5923/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-all
```

The compose file mounts the nginx config with the shared SELinux label (`z`). The `boxio-data` volume does not need an extra label.

Continue at [Start Box IO](#start-box-io).

## Start Box IO

Use this section on Ubuntu, CentOS, and Red Hat. On BlueOnyx, use the [BlueOnyx](#blueonyx) section instead. The file `docker-compose.yml` tries to bind ports 80 and 443, which the BlueOnyx panel already owns.

### 1. Clone this repository

```bash
cd ~
git clone https://github.com/Someone275/Box_IO-Docker-server.git
cd ~/Box_IO-Docker-server
```

### 2. Create the secret file

```bash
cp .env.example .env
openssl rand -hex 48
```

Open `.env` and set `JWT_SECRET` to that hex string. One line, no quotes:

```bash
JWT_SECRET=paste_the_hex_here
```

Never commit `.env`. Users, device keys, and layouts are stored in the Docker volume `boxio-data`.

### 3. Pull the image and start

```bash
curl -fL -o box_io-docker-server.tar.gz \
  https://github.com/Someone275/Box_IO-Docker-server/releases/download/v1.0.0/box_io-docker-server.tar.gz
docker load -i box_io-docker-server.tar.gz
docker compose up -d --no-build
docker compose ps
docker compose logs -f --tail=50
```

`docker load` installs the prebuilt image. `docker compose up` does not build it again. If you already pushed the image to a registry, set `BOXIO_IMAGE` in `.env` and run `docker compose pull` instead of `curl` and `docker load`.

`boxio` and `nginx` should both say Up. Ctrl+C stops following the log. It does not stop the containers. They restart with the machine because the compose file uses `unless-stopped`.

Check the hub from the server:

```bash
curl -sS http://127.0.0.1:5923/health
```

The JSON has `ok` set to true. Port 443 serves the dashboard. The first certificate is self-signed, so the browser warning is expected until the certificate step.

### 4. Issue the HTTPS certificate

From the server, this must print `boxio-http-ok`. From a phone on cellular, `http://boxio.example.com/http-ok` must show the same text.

```bash
curl -sS http://127.0.0.1/http-ok
```

```bash
chmod +x nginx/init-letsencrypt.sh nginx/ensure-certs.sh nginx/issue-cert-dns.sh
DOMAIN=boxio.example.com EMAIL=you@example.com ./nginx/init-letsencrypt.sh
```

Use an email address you can read. If the script times out, port 80 is not reachable from the internet. Use the DNS method. It prints a TXT name and value. Create that record, wait until `dig` shows it, then press Enter:

```bash
EMAIL=you@example.com ./nginx/issue-cert-dns.sh
dig +short TXT _acme-challenge.boxio.example.com
```

The DNS certificate is not renewed by the certbot loop. Run `issue-cert-dns.sh` again before 90 days.

### 5. Create the admin account

Open `https://boxio.example.com`. Create the admin user. Generate a device key. It starts with `bx_`. Put that key in the sketch as `BOXIO_AUTH`. Create a project, add widgets, choose **Save layout**, then switch to **Live**.

Pin values stay empty until **License** has a trial or a paid year. A year is $30. A trial is 30 days, once per account.

A web page can read one pin when the license is valid:

```text
https://boxio.example.com/public/bx_your_device_key/V0
```

### 6. Update

```bash
cd ~/Box_IO-Docker-server
git checkout main
git pull origin main
curl -fL -o box_io-docker-server.tar.gz \
  https://github.com/Someone275/Box_IO-Docker-server/releases/download/v1.0.0/box_io-docker-server.tar.gz
docker load -i box_io-docker-server.tar.gz
docker compose up -d --no-build
docker compose ps
```

`git pull` updates the proxy files. `docker load` updates the image from the release. If `BOXIO_IMAGE` points at Docker Hub or GHCR, use `docker compose pull` instead of `curl` and `docker load`. The volume stays. `docker compose restart` restarts the containers. `docker compose down` stops them without deleting the volume.

Nginx runs in the app container’s network and proxies to `127.0.0.1:3847`. After this compose file changes, recreate both containers:

```bash
docker compose up -d --force-recreate
```

A 502 or 504 from nginx means that recreate has not happened yet, or the `boxio` container is not running. `docker compose logs --tail=40 boxio nginx` shows which one.

## BlueOnyx

BlueOnyx 5212R is AlmaLinux 10. Apache on the panel already listens on ports 80 and 443. Use `docker-compose.blueonyx.yml`. Do not start `docker-compose.yml` on this server.

Sign in as root over SSH. BlueOnyx turns SELinux off, which Docker needs on this panel.

### 1. Install Docker Engine

```bash
dnf -y install dnf-plugins-core git
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker version
docker compose version
```

### 2. Clone, secret, and start

```bash
cd /root
git clone https://github.com/Someone275/Box_IO-Docker-server.git
cd /root/Box_IO-Docker-server
cp .env.example .env
openssl rand -hex 48
```

Put the hex string in `.env` as `JWT_SECRET`. Then load the prebuilt image:

```bash
curl -fL -o box_io-docker-server.tar.gz \
  https://github.com/Someone275/Box_IO-Docker-server/releases/download/v1.0.0/box_io-docker-server.tar.gz
docker load -i box_io-docker-server.tar.gz
docker compose -f docker-compose.blueonyx.yml up -d --no-build
docker compose -f docker-compose.blueonyx.yml ps
curl -sS http://127.0.0.1:3847/api/health
```

The dashboard API is only on `127.0.0.1:3847`. The device hub is on `5923`. Ports 80 and 443 are still the panel’s.

### 3. Open port 5923

In the BlueOnyx GUI, open **Server Management**, then **Security**, then **Firewall**, and allow TCP `5923`.

### 4. Create the dashboard site and proxy it

In **Site Management**, create a virtual site for the dashboard name, such as `boxio.example.com`. Point DNS at this server. Turn on SSL and use the panel’s Let’s Encrypt button.

```bash
cd /root/Box_IO-Docker-server
sh blueonyx/install-proxy.sh boxio.example.com
```

The script writes the proxy rules, reloads Apache, and allows TCP 5923 when firewalld is running. Open `https://boxio.example.com` and create the admin account.

If **Network Services**, **Web**, **Nginx** has the SSL proxy turned on, the same script updates that site’s Nginx file so live pin updates can use the websocket. Saving the site in the GUI can rewrite those files. Run the script again if the dashboard stops loading or live updates freeze.

The sketch host is the server’s address and the port is `5923`. Example: `http://203.0.113.10:5923`.

### 5. Update

```bash
cd /root/Box_IO-Docker-server
git checkout main
git pull origin main
curl -fL -o box_io-docker-server.tar.gz \
  https://github.com/Someone275/Box_IO-Docker-server/releases/download/v1.0.0/box_io-docker-server.tar.gz
docker load -i box_io-docker-server.tar.gz
docker compose -f docker-compose.blueonyx.yml up -d --no-build
sh blueonyx/install-proxy.sh boxio.example.com
```

The volume keeps users, device keys, and layouts.

## Upload the image to Docker Hub

The image in release v1.0.0 is already built. Docker Hub login is not stored in this repository. To publish a public Docker Hub repository named `box_io-docker-server`, create an access token at `https://hub.docker.com/settings/security`. Do not commit the token. From a machine with Docker:

```bash
export DOCKERHUB_USERNAME=your-docker-hub-user
export DOCKERHUB_TOKEN=your-token
sh push-dockerhub.sh
```

That logs in, builds this checkout, and pushes `your-docker-hub-user/box_io-docker-server`.

To make installs pull Docker Hub instead of loading the release file, set this in `.env` before `docker compose pull`:

```bash
BOXIO_IMAGE=your-docker-hub-user/box_io-docker-server:latest
```

Copy `ci/docker-image.yml` to `.github/workflows/docker-image.yml` to publish `ghcr.io/someone275/box_io-docker-server` on each push to main. Committing that path needs a token with the workflow scope. When the repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are set, the same workflow also pushes `DOCKERHUB_USERNAME/box_io-docker-server`.

## Build on the server instead

`docker compose up --build -d` builds from this checkout. Use that when you are changing the server. A normal install loads the release with `docker load`, then runs `docker compose up -d --no-build`.
