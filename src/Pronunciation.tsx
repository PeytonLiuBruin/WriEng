import { useEffect, useRef, useState } from 'react';

export interface PronunciationProps {
  word: string;
  ipa: string;
  stress?: string;
  tip?: string;
  example?: string;
  compact?: boolean;
}

export function selectEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const language = (voice: SpeechSynthesisVoice) => voice.lang.replace(/_/g, '-').toLowerCase();
  return voices.find(voice => language(voice) === 'en-us') ?? voices.find(voice => language(voice).startsWith('en-'));
}

export function Pronunciation({ word, ipa, stress, tip, example, compact = false }: PronunciationProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const [recordState, setRecordState] = useState<'idle' | 'requesting' | 'recording'>('idle');
  const [recordError, setRecordError] = useState('');
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingUrlRef = useRef<string | null>(null);
  const recordingSession = useRef(0);
  const speechSession = useRef(0);
  const ownSpeech = useRef(false);
  const mounted = useRef(true);
  const audioRef = useRef<HTMLAudioElement>(null);

  const canSpeak = typeof window !== 'undefined' && Boolean(window.speechSynthesis) && typeof window.SpeechSynthesisUtterance === 'function';
  const canRecord = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== 'undefined';
  const voice = selectEnglishVoice(voices);
  const hasUSVoice = voice?.lang.replace(/_/g, '-').toLowerCase() === 'en-us';
  const voiceStatus = !canSpeak ? '此浏览器不支持朗读；仍可阅读音标与发音提示。'
    : hasUSVoice ? `美式英语 · ${voice.name}`
    : voice ? '设备暂无美式音色，当前使用其他英语音色；口音可能不同。'
    : '设备暂未提供美式音色，将请求系统默认朗读；口音和离线可用性取决于设备。';

  useEffect(() => {
    if (!canSpeak) return;
    const synth = window.speechSynthesis;
    const refresh = () => setVoices(synth.getVoices());
    refresh();
    synth.addEventListener('voiceschanged', refresh);
    return () => synth.removeEventListener('voiceschanged', refresh);
  }, [canSpeak]);

  useEffect(() => {
    speechSession.current++;
    if (ownSpeech.current && canSpeak) window.speechSynthesis.cancel();
    ownSpeech.current = false;
    setSpeaking(false);
    setSpeechError('');
  }, [word, canSpeak]);

  useEffect(() => {
    // A recording belongs to one word. Changing the card discards its temporary audio.
    recordingSession.current++;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    audioRef.current?.pause();
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    recordingUrlRef.current = null;
    setRecordingUrl(null);
    setRecordState('idle');
    setRecordError('');
    setSeconds(0);
  }, [word]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recordingSession.current++;
      speechSession.current++;
      if (ownSpeech.current && canSpeak) window.speechSynthesis.cancel();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach(track => track.stop());
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    };
  }, [canSpeak]);

  useEffect(() => {
    if (recordState !== 'recording') return;
    const start = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 500);
    const limit = window.setTimeout(() => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    }, 60_000);
    return () => { window.clearInterval(timer); window.clearTimeout(limit); };
  }, [recordState]);

  function speak(text: string, slow: boolean) {
    if (!canSpeak) return;
    const token = ++speechSession.current;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    if (voice) utterance.voice = voice;
    utterance.rate = slow ? 0.65 : 0.95;
    utterance.pitch = 1;
    setSpeechError('');
    ownSpeech.current = true;
    setSpeaking(true);
    const complete = () => {
      if (mounted.current && speechSession.current === token) {
        ownSpeech.current = false;
        setSpeaking(false);
      }
    };
    utterance.onend = complete;
    utterance.onerror = event => {
      if (mounted.current && speechSession.current === token && event.error !== 'canceled' && event.error !== 'interrupted') {
        setSpeechError('设备未能播放语音。请检查声音或网络后再试；可继续使用音标提示。');
      }
      complete();
    };
    try { window.speechSynthesis.speak(utterance); } catch {
      setSpeechError('设备朗读暂不可用。可继续使用音标与发音提示。');
      complete();
    }
  }

  function deleteRecording() {
    audioRef.current?.pause();
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    recordingUrlRef.current = null;
    setRecordingUrl(null);
    setSeconds(0);
  }

  async function startRecording() {
    if (!canRecord || recordState !== 'idle') return;
    const session = ++recordingSession.current;
    deleteRecording();
    setRecordError('');
    setRecordState('requesting');
    if (canSpeak) { speechSession.current++; window.speechSynthesis.cancel(); ownSpeech.current = false; setSpeaking(false); }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || recordingSession.current !== session) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = formats.find(format => MediaRecorder.isTypeSupported?.(format));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onstop = () => {
        stream?.getTracks().forEach(track => track.stop());
        if (!mounted.current || recordingSession.current !== session) return;
        streamRef.current = null;
        recorderRef.current = null;
        setRecordState('idle');
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
        if (!blob.size) { setRecordError('没有收到录音，请确认麦克风后再试。'); return; }
        const url = URL.createObjectURL(blob);
        recordingUrlRef.current = url;
        setRecordingUrl(url);
      };
      recorder.onerror = () => {
        if (mounted.current && recordingSession.current === session) {
          recordingSession.current++;
          setRecordError('录音中断，请检查麦克风后重试。');
          setRecordState('idle');
          recorderRef.current = null;
          streamRef.current = null;
        }
        stream?.getTracks().forEach(track => track.stop());
        if (recorder.state !== 'inactive') recorder.stop();
      };
      recorder.start();
      setSeconds(0);
      setRecordState('recording');
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (!mounted.current || recordingSession.current !== session) return;
      streamRef.current = null;
      recorderRef.current = null;
      setRecordState('idle');
      const name = error instanceof DOMException ? error.name : '';
      setRecordError(name === 'NotAllowedError' || name === 'SecurityError'
        ? '麦克风权限未获允许。你可以在浏览器设置中允许后重试，也可直接跟读。'
        : name === 'NotFoundError' ? '没有找到麦克风。连接后可重试，也可直接跟读。'
        : '暂时无法录音，请检查麦克风后重试。');
    }
  }

  const recordingBusy = recordState !== 'idle';
  const recordingPanel = (
    <details className="voice-recording">
      <summary>录下自己，听听差别</summary>
      <p className="voice-recording-note">先听示范，再录一遍，对照重音和节奏。录音只在当前页面本机播放，不上传、不打分，离开本词后丢弃。最长 60 秒。</p>
      {recordState === 'recording'
        ? <button type="button" className="voice-record-stop" onClick={() => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); }}>停止录音 · {seconds} 秒</button>
        : <button type="button" className="voice-record-start" disabled={!canRecord || recordState === 'requesting'} onClick={startRecording}>{recordState === 'requesting' ? '等待麦克风许可…' : recordingUrl ? '重新录一遍' : '开始录音'}</button>}
      {!canRecord && <p className="voice-status">此浏览器或当前连接不支持录音。可直接跟读；本地预览请使用 localhost 或 HTTPS。</p>}
      {recordError && <p className="voice-error" role="alert">{recordError}</p>}
      {recordingUrl && <div className="voice-recorded"><audio ref={audioRef} controls src={recordingUrl} aria-label="播放我的录音" /><button type="button" className="voice-delete" onClick={deleteRecording}>删除录音</button></div>}
    </details>
  );
  return <section className={compact ? "voice-panel voice-compact" : "voice-panel"} aria-label={`${word} 发音练习`}>
    <div className="voice-phonetics"><span className="voice-ipa" lang="en-US">{ipa}</span>{!compact && stress && <span className="voice-stress">{stress}</span>}</div>
    {!compact && tip && <p className="voice-tip">{tip}</p>}
    <div className="voice-buttons">
      <button type="button" className="voice-play" disabled={!canSpeak || recordingBusy} onClick={() => speak(word, false)}>{hasUSVoice ? '听美式发音' : '听设备发音'}</button>
      <button type="button" className="voice-slow" disabled={!canSpeak || recordingBusy} onClick={() => speak(word, true)}>{compact ? '慢速' : '整词慢速播放'}</button>
      {!compact && example && <>
        <button type="button" className="voice-example" disabled={!canSpeak || recordingBusy} onClick={() => speak(example, false)}>听例句</button>
        <button type="button" className="voice-example" disabled={!canSpeak || recordingBusy} onClick={() => speak(example, true)}>慢速例句</button>
      </>}
      {speaking && <button type="button" className="voice-stop" onClick={() => { speechSession.current++; window.speechSynthesis.cancel(); ownSpeech.current = false; setSpeaking(false); }}>停止朗读</button>}
    </div>
    <p className="voice-status" role="status" title={voiceStatus}>{speechError || (compact && hasUSVoice ? '设备美式英语' : voiceStatus)}</p>
    {compact ? <details className="voice-more">
      <summary>发音细节与跟读</summary>
      {stress && <p className="voice-stress">重音：{stress}</p>}
      {tip && <p className="voice-tip">{tip}</p>}
      {example && <div className="voice-buttons">
        <button type="button" disabled={!canSpeak || recordingBusy} onClick={() => speak(example, false)}>听例句</button>
        <button type="button" disabled={!canSpeak || recordingBusy} onClick={() => speak(example, true)}>慢速例句</button>
      </div>}
      {recordingPanel}
    </details> : recordingPanel}
  </section>;
}

export default Pronunciation;
