'use client';

export function CompletenessIndicator({
  percentage,
  size = 'large',
}: {
  percentage: number;
  size?: 'large' | 'small';
}) {
  if (size === 'small') {
    return (
      <span className="text-xs text-muted-foreground tabular-nums">
        {percentage}%
      </span>
    );
  }

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
          {/* Background circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-border"
          />
          {/* Progress circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="text-primary transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-semibold text-foreground tabular-nums">
            {percentage}%
          </span>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">Profile completeness</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {percentage < 30
            ? "I'm just getting to know you. More data means better advice."
            : percentage < 60
              ? "Good start — a few more details will sharpen my recommendations."
              : percentage < 90
                ? "Solid profile. A couple more fields unlock advanced features."
                : "Comprehensive profile — I can give you my best advice."}
        </p>
      </div>
    </div>
  );
}
