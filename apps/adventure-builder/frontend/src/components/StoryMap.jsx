import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './StoryMap.css';

function PageNode({ data, selected }) {
  return (
    <div className={`pn-card${data.isStart ? ' pn-start' : ''}${data.isEnd ? ' pn-end' : ''}${selected ? ' pn-selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="pn-title">{data.label || 'Untitled'}</div>
      {data.isStart && <span className="pn-badge">Start</span>}
      {data.isEnd && <span className="pn-badge pn-end-badge">End</span>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { pageNode: PageNode };

function buildNodes(pages, selectedPageId, startPageId) {
  return pages.map(p => ({
    id: p.id,
    type: 'pageNode',
    position: p.position ?? { x: 0, y: 0 },
    data: { label: p.title, isStart: p.id === startPageId, isEnd: Boolean(p.isEnd) },
    selected: p.id === selectedPageId,
  }));
}

function buildEdges(pages) {
  return pages.flatMap(p =>
    (p.choices ?? [])
      .filter(c => c.targetPageId)
      .map(c => ({
        id: `${p.id}-${c.id}`,
        source: p.id,
        target: c.targetPageId,
        label: c.text || undefined,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#555' },
        labelStyle: { fill: '#888', fontSize: 11 },
        labelBgStyle: { fill: '#1e1e2e' },
      }))
  );
}

function StoryMapInner({ pages, selectedPageId, startPageId, onSelectPage, onPageSave, onCreatePage }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(pages, selectedPageId, startPageId));
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges(pages));

  useEffect(() => {
    setNodes(buildNodes(pages, selectedPageId, startPageId));
  }, [pages, selectedPageId, startPageId]);

  useEffect(() => {
    setEdges(buildEdges(pages));
  }, [pages]);

  const handleNodeClick = useCallback((_evt, node) => {
    onSelectPage(node.id);
  }, [onSelectPage]);

  const handleNodeDragStop = useCallback((_evt, node) => {
    onPageSave(node.id, { position: node.position });
  }, [onPageSave]);

  return (
    <div className="sm-root">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable
        edgesReconnectable={false}
      >
        <Background variant="dots" gap={16} size={1} color="#2a2a3d" />
        <Controls />
        <MiniMap
          nodeColor={n => n.data?.isStart ? '#7c3aed' : n.data?.isEnd ? '#555' : '#2a2a3d'}
          style={{ background: '#1e1e2e' }}
        />
      </ReactFlow>
      <button className="sm-add-btn" onClick={onCreatePage} title="Add page">+</button>
    </div>
  );
}

export default function StoryMap(props) {
  return (
    <ReactFlowProvider>
      <StoryMapInner {...props} />
    </ReactFlowProvider>
  );
}
