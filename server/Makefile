.PHONY: test coverage test-integration

test:
	go test ./... -race

coverage:
	go test ./... -race -coverprofile=coverage.out -covermode=atomic
	go tool cover -func=coverage.out
	go tool cover -html=coverage.out -o coverage.html

test-integration:
	go test ./internal/integration/... -v -race
