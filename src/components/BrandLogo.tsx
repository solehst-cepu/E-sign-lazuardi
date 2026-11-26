export function BrandLogo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 shrink-0 select-none">
      <svg
        width={compact ? 28 : 34}
        height={compact ? 28 : 34}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect width="36" height="36" rx="8" fill={light ? '#FFFFFF' : '#1755CE'} />
        <path
          d="M10 10.5C10 9.67157 10.6716 9 11.5 9H21.5L26 13.5V25.5C26 26.3284 25.3284 27 24.5 27H11.5C10.6716 27 10 26.3284 10 25.5V10.5Z"
          stroke={light ? '#163A70' : '#FFFFFF'}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M21 9V14H26"
          stroke={light ? '#163A70' : '#FFFFFF'}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M13.5 21.5C14.8 20.2 15.8 19.8 16.5 21C17.2 22.2 18.2 19 19.5 19.5C20.5 19.9 21.3 21 22.5 20.5"
          stroke={light ? '#1755CE' : '#93C5FD'}
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex flex-col">
        <span
          className={`font-display font-bold tracking-tight leading-none whitespace-nowrap ${
            compact ? 'text-base' : 'text-lg'
          } ${light ? 'text-white' : 'text-[#163A70]'}`}
        >
          LAZUARDI e-SIGN
        </span>
      </div>
    </div>
  );
}
