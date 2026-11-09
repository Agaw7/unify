import Image from 'next/image';

export default function AureviaLogo({ className = '' }: { className?: string }) {
  return <span className={`aurevia-logo ${className}`}><Image src="/aurevia-logo.jpg" alt="AUREVIA logo" fill sizes="(max-width: 640px) 120px, 180px" style={{ objectFit: 'cover' }} /></span>;
}
