export interface Sized {
  width: number;
  height: number;
}

export interface LaidOut<T> {
  item: T;
  width: number;
  height: number;
}

/**
 * Classic justified gallery layout: fill each row to `containerWidth` at a
 * target row height, scaling the last row down if it would be too tall.
 */
export function justifiedRows<T extends Sized>(
  items: T[],
  containerWidth: number,
  targetHeight = 320,
  gap = 8,
): LaidOut<T>[][] {
  if (containerWidth <= 0) {
    return items.map((item) => [{ item, width: item.width, height: item.height }]);
  }

  const rows: LaidOut<T>[][] = [];
  let row: T[] = [];
  let aspectSum = 0;

  const flush = (isLast: boolean) => {
    if (row.length === 0) return;
    const totalGap = gap * (row.length - 1);
    const avail = containerWidth - totalGap;
    let rowHeight = avail / aspectSum;
    if (isLast && rowHeight > targetHeight * 1.4) rowHeight = targetHeight;

    rows.push(
      row.map((item) => ({
        item,
        width: Math.round((item.width / item.height) * rowHeight),
        height: Math.round(rowHeight),
      })),
    );
    row = [];
    aspectSum = 0;
  };

  for (const item of items) {
    const aspect = item.width / item.height || 1;
    row.push(item);
    aspectSum += aspect;

    const totalGap = gap * (row.length - 1);
    const projectedHeight = (containerWidth - totalGap) / aspectSum;
    if (projectedHeight < targetHeight) flush(false);
  }
  flush(true);

  return rows;
}
