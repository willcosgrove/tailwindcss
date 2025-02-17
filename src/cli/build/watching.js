// @ts-check

import chokidar from 'chokidar'
import fs from 'fs'
import micromatch from 'micromatch'
import normalizePath from 'normalize-path'
import path from 'path'

import { readFileWithRetries } from './utils.js'

/**
 * The core idea of this watcher is:
 * 1. Whenever a file is added, changed, or renamed we queue a rebuild
 * 2. Perform as few rebuilds as possible by batching them together
 * 3. Coalesce events that happen in quick succession to avoid unnecessary rebuilds
 * 4. Ensure another rebuild happens _if_ changed while a rebuild is in progress
 */

/**
 *
 * @param {*} args
 * @param {{ state, rebuild(changedFiles: any[]): Promise<any> }} param1
 * @returns {{
 *   fswatcher: import('chokidar').FSWatcher,
 *   refreshWatchedFiles(): void,
 * }}
 */
export function createWatcher(args, { state, rebuild }) {
  let shouldPoll = args['--poll']
  let shouldCoalesceWriteEvents = shouldPoll || process.platform === 'win32'

  // Polling interval in milliseconds
  // Used only when polling or coalescing add/change events on Windows
  let pollInterval = 10

  let watcher = chokidar.watch([], {
    // Force checking for atomic writes in all situations
    // This causes chokidar to wait up to 100ms for a file to re-added after it's been unlinked
    // This only works when watching directories though
    atomic: true,

    usePolling: shouldPoll,
    interval: shouldPoll ? pollInterval : undefined,
    ignoreInitial: true,
    awaitWriteFinish: shouldCoalesceWriteEvents
      ? {
          stabilityThreshold: 50,
          pollInterval: pollInterval,
        }
      : false,
  })

  // A queue of rebuilds, file reads, etc… to run
  let chain = Promise.resolve()

  /**
   * A list of files that have been changed since the last rebuild
   *
   * @type {{file: string, content: () => Promise<string>, extension: string}[]}
   */
  let changedContent = []

  /**
   * A list of files for which a rebuild has already been queued.
   * This is used to prevent duplicate rebuilds when multiple events are fired for the same file.
   * The rebuilt file is cleared from this list when it's associated rebuild has _started_
   * This is because if the file is changed during a rebuild it won't trigger a new rebuild which it should
   **/
  let pendingRebuilds = new Set()

  let _timer
  let _reject

  /**
   * Rebuilds the changed files and resolves when the rebuild is
   * complete regardless of whether it was successful or not
   */
  async function rebuildAndContinue() {
    let changes = changedContent.splice(0)

    // There are no changes to rebuild so we can just do nothing
    if (changes.length === 0) {
      return Promise.resolve()
    }

    // Clear all pending rebuilds for the about-to-be-built files
    changes.forEach((change) => pendingRebuilds.delete(change.file))

    // Resolve the promise even when the rebuild fails
    return rebuild(changes).then(
      () => {},
      () => {}
    )
  }

  /**
   *
   * @param {*} file
   * @param {(() => Promise<string>) | null} content
   * @returns {Promise<void>}
   */
  function recordChangedFile(file, content = null) {
    file = path.resolve(file)

    // Applications like Vim/Neovim fire both rename and change events in succession for atomic writes
    // In that case rebuild has already been queued by rename, so can be skipped in change
    if (pendingRebuilds.has(file)) {
      return Promise.resolve()
    }

    // Mark that a rebuild of this file is going to happen
    // It MUST happen synchronously before the rebuild is queued for this to be effective
    pendingRebuilds.add(file)

    changedContent.push({
      file,
      content: content ?? (() => fs.promises.readFile(file, 'utf8')),
      extension: path.extname(file).slice(1),
    })

    if (_timer) {
      clearTimeout(_timer)
      _reject()
    }

    // If a rebuild is already in progress we don't want to start another one until the 10ms timer has expired
    chain = chain.then(
      () =>
        new Promise((resolve, reject) => {
          _timer = setTimeout(resolve, 10)
          _reject = reject
        })
    )

    // Resolves once this file has been rebuilt (or the rebuild for this file has failed)
    // This queues as many rebuilds as there are changed files
    // But those rebuilds happen after some delay
    // And will immediately resolve if there are no changes
    chain = chain.then(rebuildAndContinue, rebuildAndContinue)

    return chain
  }

  watcher.on('change', (file) => recordChangedFile(file))
  watcher.on('add', (file) => recordChangedFile(file))

  // Restore watching any files that are "removed"
  // This can happen when a file is pseudo-atomically replaced (a copy is created, overwritten, the old one is unlinked, and the new one is renamed)
  // TODO: An an optimization we should allow removal when the config changes
  watcher.on('unlink', (file) => {
    file = normalizePath(file)

    // Only re-add the file if it's not covered by a dynamic pattern
    if (!micromatch.some([file], state.contentPatterns.dynamic)) {
      watcher.add(file)
    }
  })

  // Some applications such as Visual Studio (but not VS Code)
  // will only fire a rename event for atomic writes and not a change event
  // This is very likely a chokidar bug but it's one we need to work around
  // We treat this as a change event and rebuild the CSS
  watcher.on('raw', (evt, filePath, meta) => {
    if (evt !== 'rename') {
      return
    }

    let watchedPath = meta.watchedPath

    // Watched path might be the file itself
    // Or the directory it is in
    filePath = watchedPath.endsWith(filePath) ? watchedPath : path.join(watchedPath, filePath)

    // Skip this event since the files it is for does not match any of the registered content globs
    if (!micromatch.some([filePath], state.contentPatterns.all)) {
      return
    }

    // Skip since we've already queued a rebuild for this file that hasn't happened yet
    if (pendingRebuilds.has(filePath)) {
      return
    }

    // We'll go ahead and add the file to the pending rebuilds list here
    // It'll be removed when the rebuild starts unless the read fails
    // which will be taken care of as well
    pendingRebuilds.add(filePath)

    async function enqueue() {
      try {
        // We need to read the file as early as possible outside of the chain
        // because it may be gone by the time we get to it. doing the read
        // immediately increases the chance that the file is still there
        let content = await readFileWithRetries(path.resolve(filePath))

        if (content === undefined) {
          return
        }

        // This will push the rebuild onto the chain
        // @ts-ignore: TypeScript isn't picking up that content is a string here
        await recordChangedFile(filePath, () => content)
      } catch {
        // If reading the file fails, it's was probably a deleted temporary file
        // So we can ignore it and no rebuild is needed
      }
    }

    enqueue().then(() => {
      // If the file read fails we still need to make sure the file isn't stuck in the pending rebuilds list
      pendingRebuilds.delete(filePath)
    })
  })

  return {
    fswatcher: watcher,

    refreshWatchedFiles() {
      watcher.add(Array.from(state.contextDependencies))
      watcher.add(Array.from(state.configDependencies))
      watcher.add(state.contentPatterns.all)
    },
  }
}
