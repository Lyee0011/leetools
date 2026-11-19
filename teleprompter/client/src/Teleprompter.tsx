"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { richClipboardScript, scriptRuns } from "./lib/script-emphasis";
import RemoteController from './RemoteController';
import { useRemoteHost } from './hooks/use-remote-host';

const DEFAULT_SCRIPT = `大家好，今天想和你分享一个简单的想法。

不用担心忘词，也不用急着赶进度。

看着屏幕中间，按照自己的节奏，自然地说出来就好。`;

const STORAGE_KEY = "tici-teleprompter-v1";
const FIRST_USE_KEY = "tici-teleprompter-gesture-seen";

type SavedState = {
  script: string;
  speed: number;
  fontSize: number;
  mirrored: boolean;
  countdownEnabled: boolean;
  promptProgress?: number;
};

type WakeLockSentinelLike = {
  release: () => Promise<void>;
};

export default function Home() {
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [speed, setSpeed] = useState(1);
  const [measuredCpm, setMeasuredCpm] = useState<number | null>(null);
  const [fontSize, setFontSize] = useState(54);
  const [mirrored, setMirrored] = useState(false);
  const [countdownEnabled, setCountdownEnabled] = useState(true);
  const [mode, setMode] = useState<"edit" | "prompt">("edit");
  const [remoteMode, setRemoteMode] = useState(false);
  const [remoteClean, setRemoteClean] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [savedProgress, setSavedProgress] = useState(0);
  const [showGestureHint, setShowGestureHint] = useState(false);
  const [shouldShowGestureHint, setShouldShowGestureHint] = useState(false);
  const [restartArmed, setRestartArmed] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [clearedScript, setClearedScript] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const scrollPositionRef = useRef(0);
  const lastProgressRef = useRef(0);
  const hideControlsRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const restartArmRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearArmRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureHintRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const formattedScript = useMemo(() => scriptRuns(script), [script]);
  const characterCount = formattedScript.reduce(
    (count, run) => count + run.text.replace(/\s/g, "").length, 0,
  );
  const baselineCpm = useMemo(
    () => Math.round((speed * 300) / 10) * 10,
    [speed],
  );
  const displayedCpm =
    mode === "prompt" && measuredCpm !== null ? measuredCpm : baselineCpm;
  const estimatedMinutes = Math.max(
    1,
    Math.ceil(characterCount / baselineCpm),
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<SavedState>;
        if (typeof parsed.script === "string") setScript(parsed.script);
        if (typeof parsed.speed === "number") setSpeed(parsed.speed);
        if (typeof parsed.fontSize === "number") setFontSize(parsed.fontSize);
        if (typeof parsed.mirrored === "boolean") setMirrored(parsed.mirrored);
        if (typeof parsed.countdownEnabled === "boolean") {
          setCountdownEnabled(parsed.countdownEnabled);
        }
        if (
          typeof parsed.promptProgress === "number" &&
          parsed.promptProgress > 0 &&
          parsed.promptProgress < 99
        ) {
          setSavedProgress(parsed.promptProgress);
        }
      }
      setShouldShowGestureHint(!localStorage.getItem(FIRST_USE_KEY));
    } catch {
      // A damaged local preference should never stop the prompter.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const saved: SavedState = {
      script,
      speed,
      fontSize,
      mirrored,
      countdownEnabled,
      promptProgress: savedProgress,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [
    countdownEnabled,
    fontSize,
    hydrated,
    mirrored,
    savedProgress,
    script,
    speed,
  ]);

  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLockRef.current?.release();
    } catch {
      // The browser may have already released it.
    }
    wakeLockRef.current = null;
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      const wakeLock = (
        navigator as Navigator & {
          wakeLock?: {
            request: (type: "screen") => Promise<WakeLockSentinelLike>;
          };
        }
      ).wakeLock;
      if (wakeLock) wakeLockRef.current = await wakeLock.request("screen");
    } catch {
      // Wake lock is an enhancement; scrolling still works without it.
    }
  }, []);

  useEffect(() => {
    if (hideControlsRef.current) clearTimeout(hideControlsRef.current);
    if (isRunning) {
      setControlsVisible(true);
      hideControlsRef.current = setTimeout(
        () => setControlsVisible(false),
        1200,
      );
    } else {
      setControlsVisible(true);
    }
  }, [isRunning]);

  const syncScrollPosition = useCallback((requestedTop?: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextTop = Math.max(
      0,
      Math.min(maximum, requestedTop ?? scroller.scrollTop),
    );
    if (typeof requestedTop === "number") scroller.scrollTop = nextTop;
    scrollPositionRef.current = nextTop;

    const nextProgress = maximum > 0 ? (nextTop / maximum) * 100 : 0;
    lastProgressRef.current = Math.floor(nextProgress);
    setProgress(nextProgress);
    if (nextProgress > 0 && nextProgress < 99) setSavedProgress(nextProgress);
  }, []);

  useEffect(() => {
    if (mode !== "prompt" || !isRunning || countdown !== null) return;

    const animate = (timestamp: number) => {
      const scroller = scrollRef.current;
      if (!scroller) return;

      if (lastFrameRef.current !== null) {
        const elapsed = Math.min(timestamp - lastFrameRef.current, 48);
        const maximum = scroller.scrollHeight - scroller.clientHeight;
        scrollPositionRef.current = Math.min(
          maximum,
          scrollPositionRef.current + (elapsed / 1000) * speed * 64,
        );
        scroller.scrollTop = scrollPositionRef.current;

        const nextProgress =
          maximum > 0
            ? Math.min(100, (scrollPositionRef.current / maximum) * 100)
            : 0;
        const roundedProgress = Math.floor(nextProgress);
        if (roundedProgress !== lastProgressRef.current) {
          lastProgressRef.current = roundedProgress;
          setProgress(nextProgress);
        }

        if (maximum > 0 && scrollPositionRef.current >= maximum - 1) {
          setProgress(100);
          setSavedProgress(0);
          setIsRunning(false);
          setControlsVisible(true);
          return;
        }
      }

      lastFrameRef.current = timestamp;
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      lastFrameRef.current = null;
    };
  }, [countdown, isRunning, mode, speed]);

  useEffect(() => {
    if (mode !== "prompt") return;

    const measure = () => {
      const scroller = scrollRef.current;
      if (!scroller || characterCount === 0) return;
      const maximum = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight,
      );
      if (maximum === 0) return;

      const durationSeconds = maximum / (speed * 64);
      const nextCpm = Math.round(
        (characterCount / Math.max(1, durationSeconds)) * 6,
      ) * 10;
      setMeasuredCpm(Math.max(50, Math.min(1000, nextCpm)));
    };

    const frame = requestAnimationFrame(measure);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (scrollRef.current) {
      resizeObserver?.observe(scrollRef.current);
      const promptCopy = scrollRef.current.querySelector(".prompt-copy");
      if (promptCopy) resizeObserver?.observe(promptCopy);
    }
    window.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [characterCount, fontSize, mode, script, speed]);

  useEffect(() => {
    if (mode !== "prompt" || countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      setIsRunning(true);
      return;
    }
    const timer = setTimeout(() => setCountdown((value) => (value ?? 1) - 1), 800);
    return () => clearTimeout(timer);
  }, [countdown, mode]);

  useEffect(() => {
    return () => {
      if (hideControlsRef.current) clearTimeout(hideControlsRef.current);
      if (restartArmRef.current) clearTimeout(restartArmRef.current);
      if (clearArmRef.current) clearTimeout(clearArmRef.current);
      if (gestureHintRef.current) clearTimeout(gestureHintRef.current);
      void releaseWakeLock();
    };
  }, [releaseWakeLock]);

  const enterPrompt = (startProgress = 0) => {
    if (!script.trim()) return;
    setMode("prompt");
    setProgress(startProgress);
    lastProgressRef.current = Math.floor(startProgress);
    scrollPositionRef.current = 0;
    setControlsVisible(true);
    setRestartArmed(false);
    setIsRunning(!countdownEnabled);
    setCountdown(countdownEnabled ? 3 : null);

    if (shouldShowGestureHint) {
      setShowGestureHint(true);
      setShouldShowGestureHint(false);
      localStorage.setItem(FIRST_USE_KEY, "1");
      gestureHintRef.current = setTimeout(
        () => setShowGestureHint(false),
        4500,
      );
    }

    requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const restoredTop = (maximum * startProgress) / 100;
      scroller.scrollTop = restoredTop;
      scrollPositionRef.current = restoredTop;
    });

    try {
      const fullscreenRequest = document.documentElement.requestFullscreen?.();
      if (fullscreenRequest) void fullscreenRequest.catch(() => undefined);
    } catch {
      // iOS Safari and some embedded browsers do not expose fullscreen.
    }
    void requestWakeLock();
  };

  const exitPrompt = async () => {
    setIsRunning(false);
    setCountdown(null);
    setMode("edit");
    setControlsVisible(true);
    setShowGestureHint(false);
    await releaseWakeLock();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Leaving prompt mode is enough if fullscreen already ended.
    }
  };

  const togglePlayback = () => {
    setShowGestureHint(false);
    if (countdown !== null) {
      setCountdown(null);
      scrollPositionRef.current = scrollRef.current?.scrollTop ?? 0;
      setIsRunning(true);
    } else {
      setIsRunning((running) => {
        if (!running) {
          scrollPositionRef.current = scrollRef.current?.scrollTop ?? 0;
        }
        return !running;
      });
    }
  };

  const restartNow = () => {
    setRestartArmed(false);
    setShowGestureHint(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    scrollPositionRef.current = 0;
    lastProgressRef.current = 0;
    setProgress(0);
    setSavedProgress(0);
    setIsRunning(!countdownEnabled);
    setCountdown(countdownEnabled ? 3 : null);
  };

  const restart = () => {
    if (!restartArmed) {
      setRestartArmed(true);
      if (restartArmRef.current) clearTimeout(restartArmRef.current);
      restartArmRef.current = setTimeout(() => setRestartArmed(false), 2200);
      return;
    }
    restartNow();
  };

  const seekToProgress = (nextProgress: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    setCountdown(null);
    setIsRunning(false);
    setControlsVisible(true);
    const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    syncScrollPosition((maximum * nextProgress) / 100);
  };

  const jumpBySeconds = (seconds: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    setCountdown(null);
    setIsRunning(seconds < 0);
    setShowGestureHint(false);
    setControlsVisible(true);
    const pixelsPerSecond = speed * 64;
    syncScrollPosition(scroller.scrollTop + pixelsPerSecond * seconds);
  };

  const clearScriptSafely = () => {
    if (!clearArmed) {
      setClearArmed(true);
      if (clearArmRef.current) clearTimeout(clearArmRef.current);
      clearArmRef.current = setTimeout(() => setClearArmed(false), 2200);
      return;
    }
    setClearedScript(script);
    setScript("");
    setSavedProgress(0);
    setClearArmed(false);
  };

  const pasteScript = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = event.clipboardData.getData("text/html");
    if (!html) return;
    let text: string | null;
    try { text = richClipboardScript(html, event.clipboardData.getData("text/plain")); }
    catch { return; }
    if (text === null) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    // Preserve native undo where supported; retain selection in the fallback.
    let inserted = false;
    try { inserted = document.execCommand("insertText", false, text); }
    catch { /* Fall back to replacing just the selection. */ }
    if (!inserted) textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, "end");
    const cursor = textarea.selectionEnd;
    setScript(textarea.value);
    setSavedProgress(0);
    setClearedScript(null);
    requestAnimationFrame(() => {
      if (textarea.isConnected && document.activeElement === textarea) textarea.setSelectionRange(cursor, cursor);
    });
  };

  const restoreClearedScript = () => {
    if (!clearedScript) return;
    setScript(clearedScript);
    setClearedScript(null);
  };

  const totalEstimatedSeconds =
    characterCount > 0 ? (characterCount / displayedCpm) * 60 : 0;
  const remainingSeconds = Math.max(
    0,
    Math.round(totalEstimatedSeconds * (1 - progress / 100)),
  );
  const remainingLabel = `${Math.floor(remainingSeconds / 60)}:${String(
    remainingSeconds % 60,
  ).padStart(2, "0")}`;
  const hasFinished = progress >= 99.5 && !isRunning && countdown === null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (mode !== "prompt") return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      }
      if (event.code === "ArrowUp" || event.code === "ArrowLeft") {
        event.preventDefault();
        jumpBySeconds(-5);
      }
      if (event.code === "ArrowDown" || event.code === "ArrowRight") {
        event.preventDefault();
        jumpBySeconds(5);
      }
      if (event.code === "Escape") void exitPrompt();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const remoteHost = useRemoteHost(mode === 'prompt' && !remoteMode, isRunning && countdown === null, progress, action => {
    setRemoteClean(true);
    if (action === 'back') jumpBySeconds(-5);
    else { setCountdown(null); setShowGestureHint(false); setIsRunning(action === 'resume'); }
  });

  if (remoteMode) return <RemoteController onExit={() => setRemoteMode(false)} />;

  if (mode === "prompt") {
    return (
      <main className="prompt-shell">
        <div
          aria-hidden="true"
          className="progress-track"
          style={{ "--progress": `${progress}%` } as React.CSSProperties}
        />

        <div
          ref={scrollRef}
          data-testid="prompt-scroller"
          data-running={isRunning ? "true" : "false"}
          className="prompt-scroller"
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            setRemoteClean(false);
            togglePlayback();
          }}
          onTouchStart={(event) => {
            setRemoteClean(false);
            setShowGestureHint(false);
            touchStartYRef.current = event.touches[0]?.clientY ?? null;
            touchMovedRef.current = false;
          }}
          onTouchMove={(event) => {
            const startY = touchStartYRef.current;
            const currentY = event.touches[0]?.clientY;
            if (startY === null || currentY === undefined) return;
            if (Math.abs(currentY - startY) > 8 && !touchMovedRef.current) {
              touchMovedRef.current = true;
              setCountdown(null);
              setIsRunning(false);
              setControlsVisible(true);
            }
          }}
          onTouchEnd={() => {
            if (touchMovedRef.current) {
              suppressClickRef.current = true;
              window.setTimeout(() => {
                suppressClickRef.current = false;
              }, 400);
            }
            touchStartYRef.current = null;
            touchMovedRef.current = false;
          }}
          onWheel={() => {
            setRemoteClean(false);
            setShowGestureHint(false);
            setCountdown(null);
            setIsRunning(false);
            setControlsVisible(true);
          }}
          onScroll={() => syncScrollPosition()}
        >
          <div
            className={`prompt-copy${mirrored ? " is-mirrored" : ""}`}
            style={
              {
                "--prompt-size": `${fontSize}px`,
              } as React.CSSProperties
            }
          >
            {formattedScript.map((run, index) => run.bold
              ? <strong key={index}>{run.text}</strong>
              : run.text)}
          </div>
        </div>

        <div className="reading-guide" aria-hidden="true">
          <span />
          <span />
        </div>

        {countdown !== null && (
          <div className="countdown-overlay" aria-live="polite">
            <span>{countdown === 0 ? "开始" : countdown}</span>
          </div>
        )}

        {showGestureHint && (
          <div className="gesture-hint" role="status">
            上下滑动回看 · 点一下继续
          </div>
        )}

        {hasFinished && (
          <section className="finish-overlay" aria-live="polite">
            <div className="finish-card">
              <span className="finish-check" aria-hidden="true">✓</span>
              <h2>已读完</h2>
              <p>这次提词已经走到结尾</p>
              <button className="finish-primary" onClick={restartNow}>
                重新开始
              </button>
              <button className="finish-secondary" onClick={exitPrompt}>
                回到文稿
              </button>
            </div>
          </section>
        )}

        <div
          className={`prompt-chrome${controlsVisible && !remoteClean ? " is-visible" : ""}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="prompt-topbar">
            <button className="chrome-button exit-button" onClick={exitPrompt}>
              <span aria-hidden="true">‹</span>
              退出
            </button>
            <span className="progress-label">
              {Math.round(progress)}% · 约剩 {remainingLabel}
            </span>
            <button className="chrome-button" onClick={restart}>
              {restartArmed ? "再点重来" : "重来"}
            </button>
          </div>

          <div className="prompt-dock">
            <div className="remote-host-strip">
              {remoteHost.room ? <><span>配对码 <b>{remoteHost.room.code}</b></span><button onClick={() => { setRemoteClean(false); void remoteHost.close(); }}>结束遥控</button></> : <button disabled={remoteHost.busy} onClick={() => { setCountdown(null); setIsRunning(false); void remoteHost.open(); }}>{remoteHost.busy ? '正在开启…' : '开启双机遥控'}</button>}
              {remoteHost.error && <span role="status">{remoteHost.error}</span>}
            </div>
            <div className="seek-control">
              <button onClick={() => jumpBySeconds(-5)} aria-label="回看五秒">
                ↶ 5秒
              </button>
              <label className="seek-slider">
                <span className="sr-only">拖动全文进度</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.1"
                  value={progress}
                  aria-label="全文进度"
                  style={
                    {
                      "--seek-progress": `${progress}%`,
                    } as React.CSSProperties
                  }
                  onChange={(event) =>
                    seekToProgress(Number(event.currentTarget.value))
                  }
                />
              </label>
              <button onClick={() => jumpBySeconds(5)} aria-label="前进五秒">
                5秒 ↷
              </button>
            </div>

            <div className="dock-main">
              <button
                className="dock-side-button"
                aria-label="减小字号"
                onClick={() => setFontSize((value) => Math.max(32, value - 4))}
              >
                <span className="small-aa">A</span>A
              </button>
              <button
                className="play-button"
                aria-label={isRunning ? "暂停" : "继续"}
                onClick={togglePlayback}
              >
                <span aria-hidden="true">{isRunning ? "Ⅱ" : "▶"}</span>
              </button>
              <button
                className="dock-side-button"
                aria-label="增大字号"
                onClick={() => setFontSize((value) => Math.min(96, value + 4))}
              >
                A<span className="large-aa">A</span>
              </button>
            </div>
            <div className="speed-control">
              <button
                aria-label="减慢滚动"
                onClick={() =>
                  setSpeed((value) => Math.max(0.4, +(value - 0.1).toFixed(1)))
                }
              >
                −
              </button>
              <span className="speed-readout">
                <b>{speed.toFixed(1)}×</b>
                <small>约 {displayedCpm} 字/分</small>
              </span>
              <button
                aria-label="加快滚动"
                onClick={() =>
                  setSpeed((value) => Math.min(2.5, +(value + 0.1).toFixed(1)))
                }
              >
                +
              </button>
            </div>
          </div>
        </div>
        {remoteClean && remoteHost.room && <button className="remote-clean-toggle" onClick={() => { setRemoteClean(false); setControlsVisible(true); }}>显示控件</button>}
      </main>
    );
  }

  return (
    <main className="editor-shell">
      <div className="editor-wrap">
        <header className="brand-row">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              提
            </span>
            <div>
              <h1>提词</h1>
              <p>贴着念，就很自然</p>
            </div>
          </div>
          <span className="saved-status">
            <i aria-hidden="true" />
            已自动保存
          </span>
        </header>

        <section className="script-card">
          <div className="section-heading">
            <label htmlFor="script">你的文稿</label>
            <span>
              {characterCount} 字 · 约 {estimatedMinutes} 分钟
            </span>
          </div>
          <p id="script-hint" className="script-hint">粘贴时保留加粗，也可用 **重音** 标记；提词时用黄色粗体显示。</p>
          <textarea
            id="script"
            aria-describedby="script-hint"
            value={script}
            onPaste={pasteScript}
            onChange={(event) => {
              setScript(event.target.value);
              setSavedProgress(0);
              setClearedScript(null);
            }}
            placeholder="把要说的话粘贴到这里，用 **重音** 标出要强调的字…"
            spellCheck={false}
          />
          <button
            className={`clear-button${clearArmed ? " is-armed" : ""}`}
            onClick={clearScriptSafely}
            disabled={!script}
          >
            {clearArmed ? "再点清空" : "清空"}
          </button>
          {clearedScript && !script && (
            <div className="undo-toast" role="status">
              <span>文稿已清空</span>
              <button onClick={restoreClearedScript}>撤销</button>
            </div>
          )}
        </section>

        <section className="settings-section">
          <div className="section-heading">
            <h2>播放设置</h2>
            <span>播放中也能随时调整</span>
          </div>

          <div className="settings-grid">
            <div className="setting-card">
              <div className="setting-copy">
                <span>字号</span>
                <strong>{fontSize}</strong>
              </div>
              <div className="stepper">
                <button
                  aria-label="减小字号"
                  onClick={() => setFontSize((value) => Math.max(32, value - 4))}
                >
                  −
                </button>
                <span className="font-preview">Aa</span>
                <button
                  aria-label="增大字号"
                  onClick={() => setFontSize((value) => Math.min(96, value + 4))}
                >
                  +
                </button>
              </div>
            </div>

            <div className="setting-card">
              <div className="setting-copy">
                <span>速度</span>
                <strong>约 {baselineCpm} 字/分</strong>
              </div>
              <div className="stepper">
                <button
                  aria-label="减慢滚动"
                  onClick={() =>
                    setSpeed((value) => Math.max(0.4, +(value - 0.1).toFixed(1)))
                  }
                >
                  −
                </button>
                <span>{speed.toFixed(1)}×</span>
                <button
                  aria-label="加快滚动"
                  onClick={() =>
                    setSpeed((value) => Math.min(2.5, +(value + 0.1).toFixed(1)))
                  }
                >
                  +
                </button>
              </div>
            </div>

            <button
              className={`toggle-card${mirrored ? " is-on" : ""}`}
              onClick={() => setMirrored((value) => !value)}
              aria-pressed={mirrored}
            >
              <span>
                <b>镜像</b>
                <small>适合反射提词器</small>
              </span>
              <i aria-hidden="true" />
            </button>

            <button
              className={`toggle-card${countdownEnabled ? " is-on" : ""}`}
              onClick={() => setCountdownEnabled((value) => !value)}
              aria-pressed={countdownEnabled}
            >
              <span>
                <b>3 秒倒计时</b>
                <small>开始前留点准备时间</small>
              </span>
              <i aria-hidden="true" />
            </button>
          </div>
        </section>

        <div className="start-area">
          {savedProgress > 1 && (
            <div className="resume-card">
              <span>
                <b>上次读到 {Math.round(savedProgress)}%</b>
                <small>可以直接从停下的位置继续</small>
              </span>
              <button onClick={() => enterPrompt(savedProgress)}>继续</button>
            </div>
          )}
          <button
            className="start-button"
            disabled={!script.trim()}
            onClick={() => enterPrompt(0)}
          >
            <span>{savedProgress > 1 ? "从头开始" : "开始提词"}</span>
            <span className="start-arrow" aria-hidden="true">
              →
            </span>
          </button>
          <p>播放时点按屏幕即可暂停或继续</p>
          <button className="remote-entry" onClick={() => setRemoteMode(true)}>用这台手机遥控另一台 →</button>
        </div>
      </div>
    </main>
  );
}
