export default {
        MAX_FILES_UPLOADED: Number(import.meta.env.VITE_MAX_FILES_UPLOADED) || 100 ,
        MAX_UPLOAD_BYTES: Number(import.meta.env.MAX_UPLOAD_BYTES) || 2048
    };