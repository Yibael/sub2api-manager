import { UsageRankingCard } from '@/components/usage-ranking'
import type { RankingRange, Sample, UserRanking } from '../../shared/domain'

const ranges: { value: RankingRange; label: string }[] = [
  { value: 'hour', label: '本小时' }, { value: 'today', label: '今天' }, { value: '7d', label: '近7天' }, { value: '30d', label: '近30天' },
]

export function UserRankingCard(props: {
  title: string; description: string; sample?: Sample<UserRanking>; error?: string; loading: boolean; currency: string;
  range: RankingRange; onRangeChange: (value: RankingRange) => void; onRefresh: () => void;
}) {
  const sample = props.sample && { ...props.sample, data: props.sample.data && { ...props.sample.data,
    rows: props.sample.data.rows.map(row => ({ ...row, id: row.userId })) } }
  return <UsageRankingCard {...props} sample={sample} dimension="用户" ranges={ranges} />
}
