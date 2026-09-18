import {create} from 'zustand';

export const useDocStore = create((set, get) => ({
    documents: [],
    setDocuments: (next) => set((state)=>({
        documents: typeof next==="function"?
        next(state.documents):
        next
    })),
    clearDocuments: () => set({documents: []})
}))