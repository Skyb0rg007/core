/** @license MIT License (c) copyright 2010-2016 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

import fatal from '../fatalError'
import { now } from '../source/now'
import { empty, isCanonicalEmpty } from '../source/empty'
import { currentTime } from '@most/scheduler'
import { Stream, Sink, Scheduler, Time, Disposable } from '@most/types'

/**
 * Turn a Stream<Promise<T>> into Stream<T> by awaiting each promise.
 * Event order is preserved. The stream will fail if any promise rejects.
 */
export const awaitPromises = <A>(stream: Stream<Promise<A>>): Stream<A> =>
  isCanonicalEmpty(stream) ? empty() : new Await(stream)

/**
 * Create a stream containing only the promise's fulfillment
 * value at the time it fulfills.
 * @param promise
 * @return stream containing promise's fulfillment value.
 *  If the promise rejects, the stream will error
 */
export const fromPromise = <A>(promise: Promise<A>): Stream<A> => awaitPromises(now(promise))

class Await<A> implements Stream<A> {
  private readonly source: Stream<Promise<A>>

  constructor(source: Stream<Promise<A>>) {
    this.source = source
  }

  run(sink: Sink<A>, scheduler: Scheduler): Disposable {
    return this.source.run(new AwaitSink(sink, scheduler), scheduler)
  }
}

class AwaitSink<A> implements Sink<Promise<A>> {
  private readonly sink: Sink<A>;
  private readonly scheduler: Scheduler;
  private queue: Promise<unknown>;

  constructor(sink: Sink<A>, scheduler: Scheduler) {
    this.sink = sink
    this.scheduler = scheduler
    this.queue = Promise.resolve()
  }

  event(_t: Time, promise: Promise<A>): void {
    this.queue = this.queue.then(() => this.handlePromise(promise))
      .catch(this.errorBound)
  }

  end(): void {
    this.queue = this.queue.then(this.endBound)
      .catch(this.errorBound)
  }

  error(_t: Time, e: Error): void {
    // Don't resolve error values, propagate directly
    this.queue = this.queue.then(() => this.errorBound(e))
      .catch(fatal)
  }

  private handlePromise(promise: Promise<A>): Promise<void> {
    return promise.then(this.eventBound)
  }

  // Pre-create closures, to avoid creating them per event
  private eventBound = (x: A): void => this.sink.event(currentTime(this.scheduler), x)
  private endBound = (): void => this.sink.end(currentTime(this.scheduler))
  private errorBound = (e: Error): void => this.sink.error(currentTime(this.scheduler), e)
}
