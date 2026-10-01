#pragma once

#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <d3d11.h>
#include <wrl/client.h>
#include <mutex>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;

class MFEncoder {
public:
    MFEncoder();
    ~MFEncoder();

    bool initialize(const std::wstring& outputPath, int width, int height, int fps,
                    ID3D11Device* device, ID3D11DeviceContext* context);
    bool writeFrame(ID3D11Texture2D* texture, int64_t timestampHns);
    // Moves the video timeline to `timestampHns`. At most a fixed number of
    // duplicate frames is written for the gap (see `kMaxBackfillFrames` in
    // mf_encoder.cpp); the rest of the gap is closed by a timestamp jump so a
    // stop after a long static span stays bounded. Returns false when nothing has
    // been written yet or the sink writer rejects a sample.
    bool extendLastFrameTo(int64_t timestampHns);
    bool finalize();

private:
    void normalizeWriteTimestampHnsLocked(int64_t timestampHns, int64_t& normalizedTimestampHns);
    bool normalizeTimelineTimestampHnsLocked(int64_t timestampHns, int64_t& normalizedTimestampHns) const;
    // `maxDuplicateFrames` counts the duplicate frames allowed per call; a negative
    // value means "no limit" (used only to reproduce the pre-fix behaviour).
    bool extendLastFrameToLocked(int64_t timestampHns, int64_t maxDuplicateFrames);
    bool writeNv12SampleLocked(const std::vector<uint8_t>& frameBuffer, int64_t timestampHns);

    ComPtr<IMFSinkWriter> sinkWriter_;
    ID3D11Device* device_ = nullptr;
    ID3D11DeviceContext* context_ = nullptr;
    ComPtr<ID3D11Texture2D> stagingTexture_;
    ComPtr<ID3D11Texture2D> resizeCompositeTexture_;
    ComPtr<ID3D11RenderTargetView> resizeCompositeView_;
    std::vector<uint8_t> nv12Buffer_;
    std::vector<uint8_t> lastFrameBuffer_;
    DWORD streamIndex_ = 0;
    int width_ = 0;
    int height_ = 0;
    int fps_ = 60;
    int64_t firstSampleTimeHns_ = -1;
    int64_t lastSampleTimeHns_ = -1;
    bool initialized_ = false;
    std::mutex mutex_;
};
