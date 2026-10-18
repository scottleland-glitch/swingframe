import { cx } from '../format';
import type { ViewAngle } from '../types';
import { Icon } from './Icons';

export function ViewPicker({
  value,
  onChange,
}: {
  value: ViewAngle | null;
  onChange: (view: ViewAngle) => void;
}) {
  return (
    <div className="view-picker" role="group" aria-label="Camera angle">
      <button
        type="button"
        className={cx('view-choice', value === 'dtl' && 'is-on')}
        aria-pressed={value === 'dtl'}
        data-testid="view-dtl"
        onClick={() => onChange('dtl')}
      >
        <Icon name="dtl" />
        <span>Down the Line</span>
        <small>{value === 'dtl' ? 'Selected' : 'Behind the ball'}</small>
      </button>
      <button
        type="button"
        className={cx('view-choice', value === 'face' && 'is-on')}
        aria-pressed={value === 'face'}
        data-testid="view-face"
        onClick={() => onChange('face')}
      >
        <Icon name="face" />
        <span>Face On</span>
        <small>{value === 'face' ? 'Selected' : 'Looking at the golfer'}</small>
      </button>
    </div>
  );
}
