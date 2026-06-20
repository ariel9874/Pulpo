/**
 * Cola asíncrona de mensajes del usuario hacia un agente. Es un `AsyncIterable`:
 * el primer elemento es el prompt inicial y los siguientes son los `send_message`
 * de una sesión en curso (entrada en streaming). `close()` termina la iteración
 * (apagado/cancelación). La comparten los adaptadores (Claude, Antigravity…).
 */
export class MessageQueue implements AsyncIterable<string> {
  private readonly values: string[] = [];
  private readonly waiters: Array<(result: IteratorResult<string>) => void> = [];
  private closed = false;

  push(value: string): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true } as IteratorResult<string>);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    for (;;) {
      const next = this.values.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.closed) return;
      const result = await new Promise<IteratorResult<string>>((resolve) =>
        this.waiters.push(resolve),
      );
      if (result.done) return;
      yield result.value;
    }
  }
}
