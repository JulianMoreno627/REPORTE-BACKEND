const HEARTBEAT_MS = 25_000;

export class NotificationController {
  #notifications;

  constructor({ notificationService }) {
    this.#notifications = notificationService;
  }

  list = async (req, res) => {
    res.json(await this.#notifications.list(req.user.id));
  };

  markRead = async (req, res) => {
    res.json(await this.#notifications.markRead(req.user.id, req.params.id));
  };

  stream = (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    res.write(`event: ready\ndata: ${JSON.stringify({ userId: req.user.id })}\n\n`);

    const unsubscribe = this.#notifications.subscribe(req.user.id, (notification) => {
      res.write(`event: notification\nid: ${notification.id}\ndata: ${JSON.stringify(notification)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  };
}
