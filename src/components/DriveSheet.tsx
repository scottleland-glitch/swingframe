import { useEffect, useState } from 'react';
import { backupAll, freeBackedUpVideos, importRemoteSwing, listRemoteSwings } from '../driveApi';
import type { SwingBackupFile } from '../driveFormat';
import { connectGoogle, disconnectGoogle, googleConnected, takeGoogleNotice } from '../googleAuth';
import { errorMessage, formatDate, viewLabel } from '../format';
import type { SwingMeta } from '../types';
import { Dialog } from './Dialog';
import { Icon } from './Icons';

export function DriveSheet({
  swings,
  onClose,
  onChanged,
}: {
  swings: SwingMeta[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [connected, setConnected] = useState(googleConnected);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmFree, setConfirmFree] = useState(false);
  const [remote, setRemote] = useState<SwingBackupFile[] | null>(null);

  useEffect(() => {
    const pending = takeGoogleNotice();
    if (pending) setNote(pending);
    setConnected(googleConnected());
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNote(null);
    try {
      await action();
      setConnected(googleConnected());
      await onChanged();
    } catch (err) {
      setNote(errorMessage(err, 'Google Drive did not finish.'));
    } finally {
      setBusy(false);
    }
  }

  const canFree = swings.some((swing) => swing.drive?.videoId && swing.videoKept !== false);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Google Drive">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Close Google Drive" onClick={onClose}>
          <Icon name="close" />
        </button>
        <div className="titles">
          <h1>Google Drive</h1>
          <p>{connected ? 'Connected' : 'Not connected'}</p>
        </div>
      </header>
      <div className="sheet-body">
        <p className="tip">
          Backups go to a Swingframe folder in your own Drive. The app only sees files it created. A sign-in lasts about
          an hour, then you connect again. On the iPhone home screen, Google opens as a full page and brings you back.
        </p>
        {note && (
          <p className="banner" data-testid="drive-status">
            {note}
          </p>
        )}
        {!connected && (
          <button
            type="button"
            className="btn primary"
            data-testid="drive-connect"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                await connectGoogle();
                setNote('Connected to Google Drive.');
              });
            }}
          >
            Connect Google Drive
          </button>
        )}
        {connected && (
          <div className="panel-actions">
            <button
              type="button"
              className="btn primary"
              data-testid="drive-backup-all"
              disabled={busy || swings.length === 0}
              onClick={() => {
                void run(async () => {
                  const result = await backupAll(swings, setNote);
                  const problem = result.failed.length ? ` ${result.failed[0]}` : '';
                  setNote(`Backed up ${result.ok} of ${swings.length}.${problem}`);
                });
              }}
            >
              Back up all
            </button>
            <button
              type="button"
              className="btn"
              data-testid="drive-free"
              disabled={busy || !canFree}
              onClick={() => setConfirmFree(true)}
            >
              Free up space
            </button>
            <button
              type="button"
              className="btn"
              data-testid="drive-restore"
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  setNote('Looking in Google Drive…');
                  const rows = await listRemoteSwings();
                  setRemote(rows);
                  setNote(rows.length === 0 ? 'Every Drive swing is already on this phone.' : null);
                });
              }}
            >
              Restore from Drive
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                disconnectGoogle();
                setConnected(false);
                setRemote(null);
                setNote('Disconnected. Files already on Drive stay there.');
              }}
            >
              Disconnect
            </button>
          </div>
        )}
        {remote && remote.length > 0 && (
          <div className="overlay-list">
            {remote.map((file) => (
              <button
                key={file.id}
                type="button"
                className="overlay-choice"
                disabled={busy}
                data-testid={`restore-${file.id}`}
                onClick={() => {
                  void run(async () => {
                    await importRemoteSwing(file, setNote);
                    setRemote((current) => current?.filter((item) => item.id !== file.id) ?? null);
                  });
                }}
              >
                <strong>{file.club || 'Swing'}</strong>
                <span>
                  {viewLabel(file.view, true)} · {formatDate(file.date)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {confirmFree && (
        <Dialog
          title="Free up space?"
          body="Videos that are already on Google Drive will be removed from this phone. The card, thumbnail, and drawings stay. You can download a video again later."
          confirmLabel="Free up space"
          danger
          confirmTestId="confirm-free"
          onCancel={() => setConfirmFree(false)}
          onConfirm={() => {
            setConfirmFree(false);
            void run(async () => {
              const freed = await freeBackedUpVideos(swings);
              setNote(freed === 0 ? 'Nothing to remove.' : `Removed ${freed} video${freed === 1 ? '' : 's'} from this phone.`);
            });
          }}
        />
      )}
    </div>
  );
}
