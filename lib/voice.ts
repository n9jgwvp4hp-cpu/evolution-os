"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice INPUT — uses the browser's built-in Speech Recognition.
 * Works great in Chrome / Edge / Safari. No API key, completely free.
 *
 * `onResult` fires once per spoken utterance with the final transcript.
 * `interim` updates live as you speak so the user can see they're being heard.
 */
export function useSpeechRecognition(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [interim, setInterim] = useState("");
  const recognitionRef = useRef<any>(null);

  // Keep the latest callback without re-binding the recognition instance.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return;
    setSupported(true);

    const recognition = new SR();
    recognition.continuous = false; // one command per utterance → clean auto-send
    recognition.interimResults = true; // live transcript
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interimText += res[0].transcript;
      }
      setInterim(interimText);
      if (finalText.trim()) {
        setInterim("");
        onResultRef.current(finalText.trim());
      }
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
    };
    recognition.onerror = () => {
      setListening(false);
      setInterim("");
    };

    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.stop();
      } catch {
        /* noop */
      }
    };
  }, []);

  const start = useCallback(() => {
    if (!recognitionRef.current || listening) return;
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  return { listening, supported, interim, start, stop };
}

/**
 * Voice OUTPUT — uses the browser's built-in Speech Synthesis to
 * read the assistant's replies out loud. Also free, no API key.
 */
export function speak(text: string, onEnd?: () => void) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(stripMarkdown(text));
  utterance.rate = 1;
  utterance.pitch = 1;
  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/** Remove markdown symbols so they aren't read aloud literally. */
function stripMarkdown(text: string): string {
  return text
    .replace(/[`*_#>~]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .trim();
}
