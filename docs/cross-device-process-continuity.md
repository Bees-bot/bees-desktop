# Thread transfer

Cross-machine continuity is an explicit thread transfer. The source stops execution and freezes the thread. The destination receives the checkpoint, verifies the digest and every attachment, then accepts the Server’s atomic ownership/epoch update. The source is fenced from further mutations. A failed offer can be redelivered or cancelled. A destination crash after commit recovers from its staged verified checkpoint. Process handles and in-flight model calls do not migrate.
