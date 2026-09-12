/** @jsxImportSource @openelement/element */
// Book cover SVGs — designed per book's atmosphere, not CSS color blocks.
// Each cover is a 200x280 SVG with visual subject + serif title.

export interface BookCoverProps {
  bookId: string;
  title: string;
  author?: string;
}

function MetamorphosisCover({ title, author }: { title: string; author?: string }) {
  return (
    <svg
      class='book-cover-svg'
      viewBox='0 0 200 280'
      xmlns='http://www.w3.org/2000/svg'
      preserveAspectRatio='xMidYMid slice'
    >
      <defs>
        <linearGradient id='meta-bg' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stop-color='#1a3a1f' />
          <stop offset='100%' stop-color='#0d1f12' />
        </linearGradient>
      </defs>
      <rect width='200' height='280' fill='url(#meta-bg)' />
      {/* Beetle silhouette — central, ominous */}
      <g transform='translate(100 130)' opacity='0.85'>
        <ellipse cx='0' cy='0' rx='32' ry='48' fill='#2d5a27' />
        <ellipse cx='0' cy='-8' rx='18' ry='14' fill='#1a3a1f' />
        {/* Legs */}
        <path
          d='M -28 -10 L -52 -22 M -28 0 L -54 0 M -28 12 L -52 24 M 28 -10 L 52 -22 M 28 0 L 54 0 M 28 12 L 52 24'
          stroke='#1a3a1f'
          stroke-width='2.5'
          stroke-linecap='round'
          fill='none'
        />
        {/* Antennae */}
        <path
          d='M -6 -22 Q -10 -32 -16 -36 M 6 -22 Q 10 -32 16 -36'
          stroke='#1a3a1f'
          stroke-width='1.5'
          fill='none'
          stroke-linecap='round'
        />
        {/* Body segmentation */}
        <line x1='-28' y1='10' x2='28' y2='10' stroke='#0d1f12' stroke-width='1' opacity='0.6' />
        <line x1='-30' y1='25' x2='30' y2='25' stroke='#0d1f12' stroke-width='1' opacity='0.6' />
      </g>
      <text
        x='100'
        y='230'
        text-anchor='middle'
        font-family='Georgia, "Times New Roman", serif'
        font-size='15'
        font-weight='600'
        fill='#e8e3d4'
        letter-spacing='0.5'
      >
        {title}
      </text>
      {author && (
        <text
          x='100'
          y='252'
          text-anchor='middle'
          font-family='Georgia, serif'
          font-size='10'
          fill='#9aa89a'
          font-style='italic'
        >
          {author}
        </text>
      )}
    </svg>
  );
}

function HeartOfDarknessCover({ title, author }: { title: string; author?: string }) {
  return (
    <svg
      class='book-cover-svg'
      viewBox='0 0 200 280'
      xmlns='http://www.w3.org/2000/svg'
      preserveAspectRatio='xMidYMid slice'
    >
      <defs>
        <linearGradient id='hod-bg' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stop-color='#3d0a0a' />
          <stop offset='60%' stop-color='#1a0303' />
          <stop offset='100%' stop-color='#000000' />
        </linearGradient>
      </defs>
      <rect width='200' height='280' fill='url(#hod-bg)' />
      {/* River winding into darkness */}
      <path
        d='M 100 40 Q 80 80 95 120 Q 110 160 85 200 Q 70 230 100 260'
        stroke='#5a1a0a'
        stroke-width='14'
        fill='none'
        opacity='0.7'
        stroke-linecap='round'
      />
      <path
        d='M 100 40 Q 80 80 95 120 Q 110 160 85 200 Q 70 230 100 260'
        stroke='#8b0000'
        stroke-width='6'
        fill='none'
        opacity='0.5'
        stroke-linecap='round'
      />
      {/* Steamboat silhouette — tiny, near the bend */}
      <g transform='translate(96 100) rotate(-15)' opacity='0.9'>
        <rect x='-14' y='-3' width='28' height='6' fill='#000' />
        <rect x='-6' y='-9' width='8' height='6' fill='#000' />
        <line x1='0' y1='-9' x2='0' y2='-14' stroke='#000' stroke-width='1' />
        <circle cx='0' cy='-16' r='2' fill='#3d0a0a' />
      </g>
      {/* Fog/mist */}
      <ellipse cx='100' cy='170' rx='80' ry='20' fill='#2a0808' opacity='0.5' />
      <text
        x='100'
        y='232'
        text-anchor='middle'
        font-family='Georgia, "Times New Roman", serif'
        font-size='13'
        font-weight='600'
        fill='#e8d4c4'
        letter-spacing='0.3'
      >
        {title}
      </text>
      {author && (
        <text
          x='100'
          y='252'
          text-anchor='middle'
          font-family='Georgia, serif'
          font-size='10'
          fill='#a8786a'
          font-style='italic'
        >
          {author}
        </text>
      )}
    </svg>
  );
}

function FrankensteinCover({ title, author }: { title: string; author?: string }) {
  return (
    <svg
      class='book-cover-svg'
      viewBox='0 0 200 280'
      xmlns='http://www.w3.org/2000/svg'
      preserveAspectRatio='xMidYMid slice'
    >
      <defs>
        <linearGradient id='frank-bg' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stop-color='#2a1f15' />
          <stop offset='100%' stop-color='#0f0a06' />
        </linearGradient>
      </defs>
      <rect width='200' height='280' fill='url(#frank-bg)' />
      {/* Lightning bolt — gothic, angular */}
      <path
        d='M 110 30 L 88 110 L 102 110 L 80 200 L 120 120 L 104 120 L 130 30 Z'
        fill='#d4a849'
        opacity='0.85'
        stroke='#8a6a2a'
        stroke-width='0.5'
      />
      {/* Stitching — Frankenstein's creature */}
      <g stroke='#8a6a2a' stroke-width='1' fill='none' opacity='0.6'>
        <line x1='60' y1='60' x2='140' y2='60' stroke-dasharray='3 3' />
        <line x1='60' y1='75' x2='140' y2='75' stroke-dasharray='3 3' />
        <line x1='60' y1='90' x2='140' y2='90' stroke-dasharray='3 3' />
      </g>
      {/* Small skull-like circle — mortality */}
      <circle
        cx='100'
        cy='135'
        r='14'
        fill='none'
        stroke='#8a6a2a'
        stroke-width='1.5'
        opacity='0.5'
      />
      <circle cx='95' cy='133' r='2' fill='#8a6a2a' opacity='0.5' />
      <circle cx='105' cy='133' r='2' fill='#8a6a2a' opacity='0.5' />
      <text
        x='100'
        y='220'
        text-anchor='middle'
        font-family='Georgia, "Times New Roman", serif'
        font-size='17'
        font-weight='700'
        fill='#e8dcc4'
        letter-spacing='0.8'
      >
        {title}
      </text>
      {author && (
        <text
          x='100'
          y='245'
          text-anchor='middle'
          font-family='Georgia, serif'
          font-size='10'
          fill='#a89878'
          font-style='italic'
        >
          {author}
        </text>
      )}
    </svg>
  );
}

/** Fallback cover for books without a designed SVG. */
function FallbackCover({ title, author }: { title: string; author?: string }) {
  return (
    <svg
      class='book-cover-svg'
      viewBox='0 0 200 280'
      xmlns='http://www.w3.org/2000/svg'
      preserveAspectRatio='xMidYMid slice'
    >
      <rect width='200' height='280' fill='#3a3530' />
      <rect x='8' y='8' width='184' height='264' fill='none' stroke='#5a554a' stroke-width='0.5' />
      <text
        x='100'
        y='140'
        text-anchor='middle'
        font-family='Georgia, serif'
        font-size='14'
        font-weight='600'
        fill='#d4cab0'
      >
        {title}
      </text>
      {author && (
        <text
          x='100'
          y='165'
          text-anchor='middle'
          font-family='Georgia, serif'
          font-size='10'
          fill='#9a9080'
          font-style='italic'
        >
          {author}
        </text>
      )}
    </svg>
  );
}

const COVERS: Record<string, typeof FallbackCover> = {
  'metamorphosis': MetamorphosisCover,
  'heart-of-darkness': HeartOfDarknessCover,
  'frankenstein': FrankensteinCover,
};

export default function BookCover({ bookId, title, author }: BookCoverProps) {
  const Cover = COVERS[bookId] ?? FallbackCover;
  return <Cover title={title} author={author} />;
}
