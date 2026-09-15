/** A compressed chain in the RGA, and a node in two independent indexes. */
export class Run {
  left: Run | null = null;
  right: Run | null = null;
  parent: Run | null = null;
  prev: Run | null = null;
  next: Run | null = null;
  idLeft: Run | null = null;
  idRight: Run | null = null;
  children: Run | null = null;
  siblingLeft: Run | null = null;
  siblingRight: Run | null = null;
  total: number;
  minDepth: number;

  constructor(
    readonly actor: number,
    readonly seq: number,
    readonly time: number,
    readonly originActor: number,
    readonly originSeq: number,
    readonly depth: number,
    public text: string,
    public deleted: boolean,
    readonly priority: number,
  ) {
    this.total = deleted ? 0 : text.length;
    this.minDepth = depth;
  }
}

function update(node: Run): void {
  node.total =
    (node.left?.total ?? 0) + (node.right?.total ?? 0) + (node.deleted ? 0 : node.text.length);
  node.minDepth = Math.min(
    node.depth,
    node.left?.minDepth ?? Number.POSITIVE_INFINITY,
    node.right?.minDepth ?? Number.POSITIVE_INFINITY,
  );
}

/** An intrusive order-statistic splay tree. The edit cursor stays near the root. */
export class Sequence {
  root: Run | null = null;
  head: Run | null = null;
  tail: Run | null = null;
  count = 0;

  splay(node: Run): void {
    while (node.parent !== null) {
      const parent = node.parent;
      const grandparent = parent.parent;
      if (grandparent !== null) {
        if ((grandparent.left === parent) === (parent.left === node)) {
          this.rotate(parent);
        } else {
          this.rotate(node);
        }
      }
      this.rotate(node);
    }
    this.root = node;
  }

  private rotate(node: Run): void {
    const parent = node.parent;
    if (parent === null) return;
    const grandparent = parent.parent;
    if (parent.left === node) {
      parent.left = node.right;
      if (node.right !== null) node.right.parent = parent;
      node.right = parent;
    } else {
      parent.right = node.left;
      if (node.left !== null) node.left.parent = parent;
      node.left = parent;
    }
    parent.parent = node;
    node.parent = grandparent;
    if (grandparent !== null) {
      if (grandparent.left === parent) grandparent.left = node;
      else grandparent.right = node;
    }
    update(parent);
    update(node);
  }

  /** Splays the run containing an existing visible code unit to the root. */
  seek(offset: number): Run {
    let remaining = offset;
    let node = this.root;
    while (node !== null) {
      const before = node.left?.total ?? 0;
      const width = node.deleted ? 0 : node.text.length;
      if (remaining < before) node = node.left;
      else if (remaining < before + width) {
        this.splay(node);
        return node;
      } else {
        remaining -= before + width;
        node = node.right;
      }
    }
    throw new RangeError("Offset is outside the visible text");
  }

  insertAfter(left: Run | null, node: Run): void {
    const right = left === null ? this.head : left.next;
    node.prev = left;
    node.next = right;
    if (left !== null) left.next = node;
    else this.head = node;
    if (right !== null) right.prev = node;
    else this.tail = node;
    if (left === null) {
      node.right = this.root;
    } else {
      this.splay(left);
      node.right = left.right;
      left.right = null;
      node.left = left;
      left.parent = node;
      update(left);
    }
    if (node.right !== null) node.right.parent = node;
    update(node);
    this.root = node;
    this.count++;
  }

  changed(node: Run): void {
    this.splay(node);
    update(node);
  }

  /** Last physical run in the RGA subtree rooted at node. */
  subtreeEnd(node: Run): Run {
    this.splay(node);
    let next = node.right;
    while (next !== null && next.minDepth <= node.depth) {
      if (next.left !== null && next.left.minDepth <= node.depth) next = next.left;
      else if (next.depth <= node.depth) {
        const previous = next.prev;
        if (previous === null) throw new Error("Invalid subtree boundary");
        return previous;
      } else next = next.right;
    }
    if (this.tail === null) throw new Error("Missing sequence tail");
    return this.tail;
  }

  remove(node: Run): void {
    this.splay(node);
    const left = node.left;
    const right = node.right;
    if (left === null) {
      this.root = right;
      if (right !== null) right.parent = null;
    } else {
      left.parent = null;
      this.root = left;
      let last = left;
      while (last.right !== null) last = last.right;
      this.splay(last);
      last.right = right;
      if (right !== null) right.parent = last;
      update(last);
    }
    if (node.prev !== null) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next !== null) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.left = null;
    node.right = null;
    node.parent = null;
    node.prev = null;
    node.next = null;
    this.count--;
  }
}

/** Per-actor interval lookup; splitting a run never copies an entire index. */
export function idFind(root: Run | null, seq: number): Run | null {
  let node = root;
  while (node !== null) {
    if (seq < node.seq) node = node.idLeft;
    else if (seq >= node.seq + node.text.length) node = node.idRight;
    else return node;
  }
  return null;
}

export function idNext(root: Run | null, seq: number): Run | null {
  let node = root;
  let next: Run | null = null;
  while (node !== null) {
    if (node.seq >= seq) {
      next = node;
      node = node.idLeft;
    } else node = node.idRight;
  }
  return next;
}

export function idInsert(root: Run | null, node: Run): Run {
  if (root === null) return node;
  if (node.seq < root.seq) {
    const child = idInsert(root.idLeft, node);
    root.idLeft = child;
    if (child.priority < root.priority) {
      root.idLeft = child.idRight;
      child.idRight = root;
      return child;
    }
  } else {
    const child = idInsert(root.idRight, node);
    root.idRight = child;
    if (child.priority < root.priority) {
      root.idRight = child.idLeft;
      child.idLeft = root;
      return child;
    }
  }
  return root;
}

function idJoin(left: Run | null, right: Run | null): Run | null {
  if (left === null) return right;
  if (right === null) return left;
  if (left.priority < right.priority) {
    left.idRight = idJoin(left.idRight, right);
    return left;
  }
  right.idLeft = idJoin(left, right.idLeft);
  return right;
}

export function idRemove(root: Run | null, seq: number): Run | null {
  if (root === null) return null;
  if (seq < root.seq) root.idLeft = idRemove(root.idLeft, seq);
  else if (seq > root.seq) root.idRight = idRemove(root.idRight, seq);
  else {
    const joined = idJoin(root.idLeft, root.idRight);
    root.idLeft = null;
    root.idRight = null;
    return joined;
  }
  return root;
}

export function siblingInsert(root: Run | null, node: Run): Run {
  if (root === null) return node;
  if (node.time < root.time || (node.time === root.time && node.actor < root.actor)) {
    const child = siblingInsert(root.siblingLeft, node);
    root.siblingLeft = child;
    if (child.priority < root.priority) {
      root.siblingLeft = child.siblingRight;
      child.siblingRight = root;
      return child;
    }
  } else {
    const child = siblingInsert(root.siblingRight, node);
    root.siblingRight = child;
    if (child.priority < root.priority) {
      root.siblingRight = child.siblingLeft;
      child.siblingLeft = root;
      return child;
    }
  }
  return root;
}

/** Sibling immediately preceding a new item in descending RGA order. */
export function previousSibling(root: Run | null, time: number, actor: number): Run | null {
  let node = root;
  let previous: Run | null = null;
  while (node !== null) {
    if (node.time > time || (node.time === time && node.actor > actor)) {
      previous = node;
      node = node.siblingLeft;
    } else node = node.siblingRight;
  }
  return previous;
}
