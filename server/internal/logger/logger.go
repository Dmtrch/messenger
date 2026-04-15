// Package logger initialises structured JSON logging to rotating log files.
//
// Usage:
//
//	logger.Init("logs")
//	logger.Error("something went wrong", "endpoint", "/api/foo", "err", err)
package logger

import (
	"io"
	"log/slog"
	"os"

	"gopkg.in/lumberjack.v2"
)

var (
	// L is the structured error/warn/info logger (writes to logs/errors.log + stderr).
	L *slog.Logger

	accessWriter io.Writer // writes to logs/access.log
)

// Init creates the logs directory and initialises L and the access writer.
// logsDir is typically "logs" (relative to the working directory).
func Init(logsDir string) error {
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		return err
	}

	errRotate := &lumberjack.Logger{
		Filename:   logsDir + "/errors.log",
		MaxSize:    50, // MB
		MaxBackups: 5,
		Compress:   true,
	}
	accessRotate := &lumberjack.Logger{
		Filename:   logsDir + "/access.log",
		MaxSize:    100,
		MaxBackups: 7,
		Compress:   true,
	}

	// Write errors to both the rotating file and stderr.
	errWriter := io.MultiWriter(os.Stderr, errRotate)
	L = slog.New(slog.NewJSONHandler(errWriter, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	accessWriter = accessRotate
	return nil
}

// AccessWriter returns the writer for access log entries (used by middleware).
func AccessWriter() io.Writer {
	if accessWriter == nil {
		return os.Stdout
	}
	return accessWriter
}

// Error logs at ERROR level via the global logger (no-op if Init was not called).
func Error(msg string, args ...any) {
	if L != nil {
		L.Error(msg, args...)
	}
}

// Warn logs at WARN level via the global logger.
func Warn(msg string, args ...any) {
	if L != nil {
		L.Warn(msg, args...)
	}
}

// Info logs at INFO level via the global logger.
func Info(msg string, args ...any) {
	if L != nil {
		L.Info(msg, args...)
	}
}
