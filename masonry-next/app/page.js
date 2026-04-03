import dynamic from 'next/dynamic'

const MasonryBoard = dynamic(() => import('../components/masonry-board'), {
  ssr: false,
})

export default function Page() {
  return <MasonryBoard />
}
