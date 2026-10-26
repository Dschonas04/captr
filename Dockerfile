# Oberflaeche bauen
FROM node:24-alpine AS oberflaeche
WORKDIR /bau/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
RUN npx tsc --noEmit -p . && npx vite build

# Dienst bauen, Oberflaeche eingebettet
FROM golang:1.27-alpine AS dienst
WORKDIR /bau/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=oberflaeche /bau/backend/web ./web
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /captr .

# LibRaw fuer RAW, exiftool fuer Aufnahmedaten, libheif fuer HEIC
FROM alpine:3.24
RUN apk add --no-cache libraw-tools exiftool libheif-tools ca-certificates tzdata \
    && adduser -D -H -u 10001 captr \
    && mkdir /daten && chown captr /daten
COPY --from=dienst /captr /usr/local/bin/captr
USER captr
ENV CAPTR_DATEN=/daten PORT=8080 TZ=Europe/Berlin
VOLUME /daten
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/status >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/captr"]
