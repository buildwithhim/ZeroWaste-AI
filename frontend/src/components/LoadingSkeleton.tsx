type LoadingSkeletonProps = { className?: string };

export default function LoadingSkeleton({ className = "" }: LoadingSkeletonProps) {
  return <span className={`loading-skeleton ${className}`} aria-hidden="true" />;
}
