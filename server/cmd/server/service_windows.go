//go:build windows

package main

import (
	"log"
	"net/http"

	"golang.org/x/sys/windows/svc"
)

// messengerService реализует svc.Handler — мост между Windows Service Control
// Manager (SCM) и HTTP-сервером. Без него бинарник, зарегистрированный через
// `sc create`, не отвечает SCM сигналом SERVICE_RUNNING и убивается по таймауту
// (ошибка 1053).
type messengerService struct {
	serve    func() error // блокирующий запуск HTTP-сервера
	shutdown func()        // graceful-остановка HTTP-сервера
}

func (m *messengerService) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (ssec bool, errno uint32) {
	const accepted = svc.AcceptStop | svc.AcceptShutdown

	changes <- svc.Status{State: svc.StartPending}

	// HTTP-сервер блокирует, поэтому крутим его в отдельной горутине,
	// а здесь обрабатываем команды SCM.
	errCh := make(chan error, 1)
	go func() { errCh <- m.serve() }()

	changes <- svc.Status{State: svc.Running, Accepts: accepted}

	for {
		select {
		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				changes <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				changes <- svc.Status{State: svc.StopPending}
				m.shutdown()
				return false, 0
			default:
				log.Printf("service: unexpected control request #%d", c.Cmd)
			}
		case err := <-errCh:
			// Сервер завершился сам (ошибка запуска или штатное закрытие).
			if err != nil && err != http.ErrServerClosed {
				log.Printf("service: server exited with error: %v", err)
				return false, 1
			}
			return false, 0
		}
	}
}

// isWindowsService сообщает, запущен ли процесс под управлением SCM.
func isWindowsService() bool {
	is, err := svc.IsWindowsService()
	if err != nil {
		return false
	}
	return is
}

// runService запускает сервер под управлением SCM.
func runService(serve func() error, shutdown func()) error {
	return svc.Run("Messenger", &messengerService{serve: serve, shutdown: shutdown})
}
