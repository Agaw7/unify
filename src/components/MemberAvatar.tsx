import Image from 'next/image';

export default function MemberAvatar() {
  return <div className="member-avatar member-avatar-unify">
    <Image src="/aromeva-logo.png" alt="AROMEVA" width={64} height={64} />
  </div>;
}
