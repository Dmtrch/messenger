//go:build !windows

package main

// На не-Windows платформах нет SCM: сервис-обёртка вырождается в прямой запуск.

func isWindowsService() bool { return false }

func runService(serve func() error, shutdown func()) error {
	return serve()
}
