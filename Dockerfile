# Stage 1: Build client
FROM node:20-alpine AS client-builder
WORKDIR /app
COPY client/package*.json ./
RUN npm install
COPY client/ .
RUN npm run build

# Stage 2: Build server
FROM golang:1.22-alpine AS server-builder
WORKDIR /app
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ .
# Copy built client into the directory adjacent to main.go for go:embed
COPY --from=client-builder /app/dist ./cmd/server/static
RUN CGO_ENABLED=0 GOOS=linux go build -o /bin/messenger ./cmd/server

# Stage 3: Final image
FROM alpine:3.20

LABEL maintainer="dmtrch.cd@gmail.com" \
      version="1.0.0" \
      description="Self-hosted E2E encrypted messenger"

RUN apk add --no-cache ca-certificates tzdata wget

RUN addgroup -S messenger && adduser -S messenger -G messenger

RUN mkdir -p /data/media && chown -R messenger:messenger /data

COPY --from=server-builder /bin/messenger /bin/messenger

ENV DB_PATH=/data/messenger.db \
    MEDIA_DIR=/data/media

VOLUME ["/data"]

USER messenger

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:8080/api/server/info || exit 1

CMD ["/bin/messenger"]
