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
COPY server/go.mod ./
RUN go mod download && go mod tidy 2>/dev/null || true
COPY server/ .
# Copy built client into the directory adjacent to main.go for go:embed
COPY --from=client-builder /app/dist ./cmd/server/static
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /bin/messenger ./cmd/server

# Stage 3: Final image
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=server-builder /bin/messenger /bin/messenger
EXPOSE 8080
CMD ["/bin/messenger"]
