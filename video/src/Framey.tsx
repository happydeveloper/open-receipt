// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 안내 캐릭터 "프레이미". 영수증을 끼운 액자 모양이다. 이 영상을 위해 새로 그린 그림이다.
 * 가만히 있을 때는 천천히 위아래로 움직이고 가끔 눈을 깜빡이며, 말할 때는 입이 움직인다.
 */
import { useCurrentFrame } from "remotion";

export const Framey = ({ size = 220, talking = true }: { size?: number; talking?: boolean }) => {
  const f = useCurrentFrame();
  const bob = Math.sin(f / 14) * 5;
  const blink = f % 96 < 4;
  const mouth = talking ? 5 + Math.abs(Math.sin(f / 2.6)) * 11 : 4;
  const wave = Math.sin(f / 7) * 12;
  return (
    <svg width={size} height={size} viewBox="0 0 220 220" style={{ transform: `translateY(${bob}px)`, overflow: "visible" }}>
      {/* 팔 */}
      <path d={`M40 128 Q14 ${118 + wave} 22 ${92 + wave}`} stroke="#1f6f43" strokeWidth="9" strokeLinecap="round" fill="none" />
      <path d="M180 128 Q206 138 198 160" stroke="#1f6f43" strokeWidth="9" strokeLinecap="round" fill="none" />
      {/* 다리 */}
      <path d="M86 196 v16 M134 196 v16" stroke="#1f6f43" strokeWidth="9" strokeLinecap="round" />
      {/* 액자 */}
      <rect x="34" y="26" width="152" height="172" rx="22" fill="#2f9e62" />
      <rect x="34" y="26" width="152" height="172" rx="22" fill="none" stroke="#1f6f43" strokeWidth="5" />
      {/* 액자 안의 영수증 */}
      <path d="M54 46 h112 v124 l-9.3 8 -9.3 -8 -9.3 8 -9.3 -8 -9.3 8 -9.3 -8 -9.3 8 -9.3 -8 -9.3 8 -9.3 -8 -9.3 8 -9.4 -8 z" fill="#fffdf6" />
      <path d="M70 66 h44 M70 80 h80 M70 138 h36 M124 138 h26" stroke="#d6d0bf" strokeWidth="5" strokeLinecap="round" />
      {/* 얼굴 */}
      {blink ? <path d="M84 104 h14 M122 104 h14" stroke="#1c2430" strokeWidth="5" strokeLinecap="round" /> : <>
        <circle cx="91" cy="104" r="7" fill="#1c2430" /><circle cx="129" cy="104" r="7" fill="#1c2430" />
        <circle cx="93.5" cy="101.5" r="2.2" fill="#fff" /><circle cx="131.5" cy="101.5" r="2.2" fill="#fff" />
      </>}
      <ellipse cx="110" cy="122" rx="11" ry={mouth / 2} fill="#1c2430" />
      <circle cx="74" cy="118" r="6" fill="#ffc9c2" opacity="0.9" /><circle cx="146" cy="118" r="6" fill="#ffc9c2" opacity="0.9" />
    </svg>
  );
};
